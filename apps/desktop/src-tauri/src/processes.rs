//! Willow's own processes: its server and the local companion, both Node.
//!
//! They live and die with the app. On Windows every child joins a job object
//! that kills it when Willow's process goes away, however it goes away, so a
//! crash never leaves a server holding Willow's port. Elsewhere each child
//! leads its own process group and gets SIGTERM, then SIGKILL.

use std::{
    fs::File,
    path::Path,
    process::{Child, Command, Stdio},
    sync::Mutex,
};

#[derive(Default)]
pub struct Children {
    running: Mutex<Vec<(String, Child)>>,
    #[cfg(windows)]
    job: job::Job,
}

pub struct Launch<'a> {
    pub name: &'a str,
    pub program: &'a Path,
    pub args: &'a [&'a str],
    pub cwd: &'a Path,
    pub env: &'a [(&'a str, &'a str)],
    /// Where its output goes, for diagnosing a failed start.
    pub log: &'a Path,
}

impl Children {
    pub fn spawn(&self, launch: Launch) -> std::io::Result<()> {
        self.spawn_with_input(launch, None, &[])
    }

    /// As `spawn`, with `input` written to the child's stdin, which then closes, and without the
    /// variables in `without` from Willow's own environment.
    pub fn spawn_with_input(&self, launch: Launch, input: Option<&[u8]>, without: &[&str]) -> std::io::Result<()> {
        let output = File::create(launch.log)?;
        let errors = output.try_clone()?;
        let mut command = Command::new(launch.program);
        command
            .args(launch.args)
            .current_dir(launch.cwd)
            .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::from(output))
            .stderr(Stdio::from(errors));
        for key in without {
            command.env_remove(key);
        }
        for (key, value) in launch.env {
            command.env(key, value);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command.spawn()?;
        #[cfg(windows)]
        self.job.assign(&child);
        if let (Some(input), Some(mut stdin)) = (input, child.stdin.take()) {
            use std::io::Write;
            stdin.write_all(input)?;
        }
        self.running.lock().unwrap().push((launch.name.to_string(), child));
        Ok(())
    }

    /// Whether the named process has exited, and how.
    pub fn exit_status(&self, name: &str) -> Option<String> {
        let mut running = self.running.lock().unwrap();
        let (_, child) = running.iter_mut().find(|(candidate, _)| candidate == name)?;
        match child.try_wait() {
            Ok(Some(status)) => Some(status.to_string()),
            _ => None,
        }
    }

    /// Stops the named process, as `stop_all` stops them all.
    pub fn stop(&self, name: &str) {
        let child = {
            let mut running = self.running.lock().unwrap();
            running.iter().position(|(candidate, _)| candidate == name).map(|index| running.remove(index).1)
        };
        let Some(mut child) = child else { return };
        #[cfg(windows)]
        {
            let _ = child.kill();
            let _ = child.wait();
        }
        #[cfg(unix)]
        {
            use std::time::{Duration, Instant};
            // SAFETY: signalling the process group this child leads.
            unsafe { libc::kill(-(child.id() as i32), libc::SIGTERM) };
            let deadline = Instant::now() + Duration::from_secs(3);
            while Instant::now() < deadline && matches!(child.try_wait(), Ok(None)) {
                std::thread::sleep(Duration::from_millis(50));
            }
            if matches!(child.try_wait(), Ok(None)) {
                unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL) };
                let _ = child.wait();
            }
        }
    }

    pub fn stop_all(&self) {
        let children: Vec<(String, Child)> = self.running.lock().unwrap().drain(..).collect();
        #[cfg(windows)]
        {
            self.job.terminate();
            for (_, mut child) in children {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        #[cfg(unix)]
        {
            use std::time::{Duration, Instant};
            for (_, child) in &children {
                // SAFETY: signalling the process group this child leads.
                unsafe { libc::kill(-(child.id() as i32), libc::SIGTERM) };
            }
            let deadline = Instant::now() + Duration::from_secs(3);
            for (_, mut child) in children {
                while Instant::now() < deadline && matches!(child.try_wait(), Ok(None)) {
                    std::thread::sleep(Duration::from_millis(50));
                }
                if matches!(child.try_wait(), Ok(None)) {
                    unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL) };
                    let _ = child.wait();
                }
            }
        }
    }
}

#[cfg(windows)]
mod job {
    use std::{ffi::c_void, mem, os::windows::io::AsRawHandle, process::Child, ptr};
    use windows_sys::Win32::{
        Foundation::HANDLE,
        System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
            TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
    };

    /// A job object whose processes die when its last handle closes — at the latest, when Willow exits.
    pub struct Job(HANDLE);

    // SAFETY: a job handle may be used from any thread.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Default for Job {
        fn default() -> Self {
            // SAFETY: plain Win32 calls on a handle this struct owns.
            unsafe {
                let handle = CreateJobObjectW(ptr::null(), ptr::null());
                if !handle.is_null() {
                    let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = mem::zeroed();
                    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                    SetInformationJobObject(
                        handle,
                        JobObjectExtendedLimitInformation,
                        &info as *const _ as *const c_void,
                        mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                    );
                }
                Job(handle)
            }
        }
    }

    impl Job {
        pub fn assign(&self, child: &Child) {
            if !self.0.is_null() {
                // SAFETY: the child's process handle is valid while `child` lives.
                unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle() as HANDLE) };
            }
        }

        pub fn terminate(&self) {
            if !self.0.is_null() {
                // SAFETY: as above.
                unsafe { TerminateJobObject(self.0, 0) };
            }
        }
    }
}
