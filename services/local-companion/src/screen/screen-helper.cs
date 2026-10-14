// Willow's eyes and hands on the user's own screen (screen.mjs): one process, a JSON request per line on stdin and a
// JSON answer per line on stdout. Compiled by the companion with the .NET Framework's own C# 5 compiler, and declared
// per-monitor DPI aware in its manifest, so what it captures and where it clicks are the screen's real pixels.
//
// It never acts on Willow's own windows — a bot must not be able to approve its own requests — and it holds off while
// the user is using the computer. Their own hand on the mouse and keyboard is told from input any program puts in by
// the flag Windows sets on injected input: their touch holds the next action off, and stops typing under way. After
// each action it waits for the screen to settle, so the bot's next look shows where the action ended.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace WillowScreen
{
    [StructLayout(LayoutKind.Sequential)]
    struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct MONITORINFOEX
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

    [StructLayout(LayoutKind.Sequential)]
    struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT ptScreenPos; }

    [StructLayout(LayoutKind.Sequential)]
    struct ICONINFO { public bool fIcon; public int xHotspot; public int yHotspot; public IntPtr hbmMask; public IntPtr hbmColor; }

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx; public int dy; public int mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Explicit)]
    struct INPUTUNION
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public INPUTUNION u; }

    [StructLayout(LayoutKind.Sequential)]
    struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData; public uint flags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }

    delegate bool MonitorEnumProc(IntPtr monitor, IntPtr hdc, ref RECT rect, IntPtr data);

    delegate IntPtr InputHookProc(int code, IntPtr wParam, IntPtr lParam);

    static class Native
    {
        [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
        [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
        [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
        [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int max);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
        [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
        [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc callback, IntPtr data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFOEX info);
        [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);
        [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO info);
        [DllImport("user32.dll")] public static extern bool GetIconInfo(IntPtr icon, out ICONINFO info);
        [DllImport("user32.dll")] public static extern bool DrawIconEx(IntPtr hdc, int x, int y, IntPtr icon, int width, int height, int step, IntPtr brush, int flags);
        [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr handle);
        [DllImport("user32.dll")] public static extern short VkKeyScan(char character);
        [DllImport("user32.dll")] public static extern short VkKeyScanEx(char character, IntPtr layout);
        [DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint thread);
        [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
        [DllImport("kernel32.dll")] public static extern uint GetTickCount();
        [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
        [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder info, int length, out int needed);
        [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SetWindowsHookEx(int kind, InputHookProc proc, IntPtr module, uint thread);
        [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] public static extern int GetMessage(out MSG message, IntPtr window, uint min, uint max);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr GetModuleHandle(string name);
        [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
        [DllImport("advapi32.dll", SetLastError = true)] public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)] public static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr info, int length, out int needed);
        [DllImport("advapi32.dll")] public static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
        [DllImport("advapi32.dll")] public static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
    }

    class Refusal : Exception
    {
        public readonly string Reason;
        public Refusal(string reason, string message) : base(message) { Reason = reason; }
    }

    /// A character the keyboard in use has no key for — "é" on an English one. `Alone` when it was all there was to
    /// press, so it can go in as typing does instead.
    class NotOnLayout : Exception
    {
        public readonly char Character;
        public readonly bool Alone;
        public NotOnLayout(char character, bool alone)
            : base("\"" + character + "\" has no key of its own on this keyboard, so it cannot be pressed with others. Type it instead.")
        {
            Character = character;
            Alone = alone;
        }
    }

    class Monitor
    {
        public int Index;
        public bool Primary;
        public RECT Bounds;
        // The monitor without its taskbar and docked bars.
        public RECT Work;
        public uint Dpi;
    }

    /// The user's own hand on the mouse and keyboard, told from input any program puts in — the bot's own among it — by
    /// the flag Windows sets on injected input. Low-level hooks on a thread of their own note only when, never what: no
    /// key is kept.
    static class InputWatch
    {
        static InputHookProc keyboardProc, mouseProc;
        static IntPtr keyboardHook = IntPtr.Zero, mouseHook = IntPtr.Zero;
        static volatile bool running;
        static uint startedAt;
        // When the user last pressed a key, a mouse button or the wheel, and last moved the mouse; 0 for not since the start.
        static volatile uint lastPress, lastMove;
        // Where the helper last set the pointer itself, and when: a move there just after is its own, flagged or not.
        static volatile int placedX = int.MinValue, placedY = int.MinValue;
        static volatile uint placedAt;

        public static bool Running { get { return running; } }

        public static uint StartedAt { get { return startedAt; } }

        public static void Start()
        {
            if (running) return;
            ManualResetEvent ready = new ManualResetEvent(false);
            Thread thread = new Thread(delegate ()
            {
                keyboardProc = OnKey;
                mouseProc = OnMouse;
                IntPtr module = Native.GetModuleHandle(null);
                keyboardHook = Native.SetWindowsHookEx(13, keyboardProc, module, 0);
                mouseHook = Native.SetWindowsHookEx(14, mouseProc, module, 0);
                startedAt = Native.GetTickCount();
                running = keyboardHook != IntPtr.Zero && mouseHook != IntPtr.Zero;
                ready.Set();
                MSG message;
                while (Native.GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { }
            });
            thread.IsBackground = true;
            thread.Name = "input-watch";
            thread.Start();
            ready.WaitOne(3000);
        }

        public static void Placed(int x, int y)
        {
            placedX = x;
            placedY = y;
            placedAt = Native.GetTickCount();
        }

        static uint Stamp()
        {
            uint now = Native.GetTickCount();
            return now == 0 ? 1 : now;
        }

        static IntPtr OnKey(int code, IntPtr wParam, IntPtr lParam)
        {
            try
            {
                int message = wParam.ToInt32();
                if (code >= 0 && (message == 0x0100 || message == 0x0104))
                {
                    KBDLLHOOKSTRUCT info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                    // LLKHF_INJECTED and LLKHF_LOWER_IL_INJECTED: a key a program put in.
                    if ((info.flags & 0x12) == 0) lastPress = Stamp();
                }
            }
            catch { }
            return Native.CallNextHookEx(keyboardHook, code, wParam, lParam);
        }

        static IntPtr OnMouse(int code, IntPtr wParam, IntPtr lParam)
        {
            try
            {
                if (code >= 0)
                {
                    MSLLHOOKSTRUCT info = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
                    // LLMHF_INJECTED and LLMHF_LOWER_IL_INJECTED: mouse input a program put in.
                    if ((info.flags & 0x03) == 0)
                    {
                        if (wParam.ToInt32() != 0x0200) lastPress = Stamp();
                        else if (!(info.pt.X == placedX && info.pt.Y == placedY && unchecked(Native.GetTickCount() - placedAt) < 500)) lastMove = Stamp();
                    }
                }
            }
            catch { }
            return Native.CallNextHookEx(mouseHook, code, wParam, lParam);
        }

        /// Milliseconds since the user's own last input of any kind, or -1 for none since the watch began.
        public static long IdleMs()
        {
            uint press = lastPress, move = lastMove;
            uint last = press == 0 ? move : move == 0 ? press : unchecked((int)(press - move)) >= 0 ? press : move;
            return last == 0 ? -1 : (long)unchecked(Native.GetTickCount() - last);
        }

        /// Whether the user has pressed a key, a button or the wheel since `tick`: what takes the keyboard from the bot.
        public static bool PressedSince(uint tick)
        {
            uint press = lastPress;
            return running && press != 0 && unchecked((int)(press - tick)) > 0;
        }
    }

    /// Whether a window's program runs with more rights than the helper — as administrator — where Windows keeps other
    /// programs' input and UI Automation out without a word (UIPI); such a window is turned down out loud instead.
    static class Elevation
    {
        const int UNKNOWN = -1;
        static int own = -2;

        public static bool Above(uint pid)
        {
            if (own == -2) own = Level(Native.GetCurrentProcess(), false);
            if (own == UNKNOWN || pid == 0) return false;
            // PROCESS_QUERY_LIMITED_INFORMATION, which Windows grants on a process above the caller too.
            IntPtr process = Native.OpenProcess(0x1000, false, pid);
            if (process == IntPtr.Zero) return false;
            try { return Level(process, true) > own; }
            finally { Native.CloseHandle(process); }
        }

        /// A process's integrity level (0x2000 medium, 0x3000 high, 0x4000 system). A token closed to the helper is
        /// above it when `closedIsAbove`; what cannot be told is unknown.
        static int Level(IntPtr process, bool closedIsAbove)
        {
            IntPtr token;
            if (!Native.OpenProcessToken(process, 0x0008, out token)) return closedIsAbove && Marshal.GetLastWin32Error() == 5 ? int.MaxValue : UNKNOWN;
            try
            {
                int needed;
                // TokenIntegrityLevel: a TOKEN_MANDATORY_LABEL, whose SID's last sub-authority is the level.
                Native.GetTokenInformation(token, 25, IntPtr.Zero, 0, out needed);
                if (needed <= 0) return UNKNOWN;
                IntPtr buffer = Marshal.AllocHGlobal(needed);
                try
                {
                    if (!Native.GetTokenInformation(token, 25, buffer, needed, out needed)) return UNKNOWN;
                    IntPtr sid = Marshal.ReadIntPtr(buffer);
                    int count = Marshal.ReadByte(Native.GetSidSubAuthorityCount(sid));
                    if (count == 0) return UNKNOWN;
                    return Marshal.ReadInt32(Native.GetSidSubAuthority(sid, (uint)(count - 1)));
                }
                finally { Marshal.FreeHGlobal(buffer); }
            }
            finally { Native.CloseHandle(token); }
        }
    }

    /// Work that waits on another program — UI Automation asks the app itself — done on a thread of its own and waited
    /// for only so long: an app that has stopped answering costs that one request, never the helper. The thread is left
    /// to finish whenever the app answers, if it ever does.
    static class Patience
    {
        public static T Run<T>(int timeoutMs, string late, Func<T> work)
        {
            T result = default(T);
            Exception failure = null;
            ManualResetEvent done = new ManualResetEvent(false);
            Thread thread = new Thread(delegate ()
            {
                try { result = work(); }
                catch (Exception error) { failure = error; }
                finally { done.Set(); }
            });
            thread.IsBackground = true;
            thread.Start();
            if (!done.WaitOne(timeoutMs)) throw new Exception(late);
            done.Close();
            if (failure != null) throw failure;
            return result;
        }
    }

    static class Program
    {
        const uint INPUT_MOUSE = 0;
        const uint INPUT_KEYBOARD = 1;
        const uint MOUSEEVENTF_MOVE = 0x0001;
        const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        const uint MOUSEEVENTF_LEFTUP = 0x0004;
        const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        const uint MOUSEEVENTF_WHEEL = 0x0800;
        const uint MOUSEEVENTF_HWHEEL = 0x1000;
        const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
        const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
        const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        const uint KEYEVENTF_KEYUP = 0x0002;
        const uint KEYEVENTF_UNICODE = 0x0004;
        const uint GA_ROOT = 2;
        const string LOCKED = "The screen is locked, or Windows is showing a prompt that only the user can answer.";

        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 16 };
        // Answers and the overlay's events share stdout, one whole line at a time.
        static readonly object OutputLock = new object();
        static TextWriter output;
        static readonly HashSet<string> ProtectedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        static readonly HashSet<uint> ProtectedPids = new HashSet<uint>();
        // When this process last finished putting input in: without the watch, input after it but not from it is the user's.
        static uint lastInjectedAt;
        // How recent the user's own input must be to hold the next action off.
        const uint USER_QUIET_MS = 1500;

        [STAThread]
        static int Main(string[] args)
        {
            try { Native.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
            for (int index = 0; index + 1 < args.Length; index++)
            {
                // Draws the overlay's parts to files and stops: how it looks, checked where captures leave it out.
                if (args[index] == "--render-samples")
                {
                    Overlay.RenderSamples(args[index + 1], index + 2 < args.Length ? args[index + 2] : "Pip", index + 3 < args.Length ? args[index + 3] : "");
                    return 0;
                }
                // What a key combination comes to on this keyboard, pressing nothing: how the keys are checked.
                if (args[index] == "--keys")
                {
                    Console.Out.WriteLine(Json.Serialize(KeyPlan(args[index + 1])));
                    return 0;
                }
            }
            for (int index = 0; index + 1 < args.Length; index += 2)
            {
                if (args[index] == "--protect-name") ProtectedNames.Add(args[index + 1]);
                else if (args[index] == "--protect-pid") { uint pid; if (uint.TryParse(args[index + 1], out pid)) ProtectedPids.Add(pid); }
            }
            ProtectedNames.Add("willow-desktop");
            InputWatch.Start();
            TextReader input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            // The user stopped the bot from the overlay: said at once, off the overlay's thread, which must not wait.
            Overlay.Stopped = delegate (string how, string grant, string session)
            {
                ThreadPool.QueueUserWorkItem(delegate
                {
                    Emit(new Dictionary<string, object> { { "event", "stopped" }, { "how", how }, { "grant", grant }, { "session", session } });
                });
            };
            Emit(new Dictionary<string, object> { { "ready", true }, { "pid", Process.GetCurrentProcess().Id } });
            string line;
            while ((line = input.ReadLine()) != null)
            {
                if (line.Trim().Length == 0) continue;
                object id = null;
                Dictionary<string, object> answer;
                try
                {
                    Dictionary<string, object> request = Json.Deserialize<Dictionary<string, object>>(line);
                    request.TryGetValue("id", out id);
                    answer = new Dictionary<string, object> { { "id", id }, { "ok", true }, { "result", Handle(request) } };
                }
                catch (Refusal refusal)
                {
                    answer = new Dictionary<string, object> { { "id", id }, { "ok", false }, { "refused", refusal.Reason }, { "error", refusal.Message } };
                }
                catch (Exception error)
                {
                    answer = new Dictionary<string, object> { { "id", id }, { "ok", false }, { "error", error.Message } };
                }
                Emit(answer);
            }
            Overlay.End();
            return 0;
        }

        static void Emit(Dictionary<string, object> message)
        {
            string text = Json.Serialize(message);
            lock (OutputLock)
            {
                output.WriteLine(text);
                output.Flush();
            }
        }

        static object Handle(Dictionary<string, object> request)
        {
            string op = Text(request, "op");
            if (op == "info") return Info();
            if (op == "capture") return Capture(Int(request, "monitor", -1));
            if (op == "act") return Act(request);
            if (op == "apps") return UiAutomation.Apps();
            // Reading a window's controls is like looking at it: only a locked screen stops it, not the user at work.
            if (op == "elements")
            {
                if (Locked()) throw new Refusal("locked", LOCKED);
                return Patience.Run<object>(22000, "The app did not answer in time — it may be busy or stuck — so its controls could not be read. Look at it, and try again in a moment or work it by pointing.", delegate { return UiAutomation.Elements(request); });
            }
            if (op == "element")
            {
                Guard();
                return Patience.Run<object>(14000, "The app did not answer in time — it may be busy or stuck — and what you asked may still happen once it does. Look before you try again.", delegate { return UiAutomation.Act(request); });
            }
            if (op == "focus")
            {
                Guard();
                return Patience.Run<object>(10000, "The window did not come to the front in time: its app may be busy or stuck.", delegate { return UiAutomation.Focus(request); });
            }
            if (op == "begin")
            {
                Overlay.Begin(Text(request, "name"), Text(request, "color"), Text(request, "grant"), Text(request, "session"));
                return new Dictionary<string, object> { { "shown", Overlay.Active } };
            }
            if (op == "end")
            {
                Overlay.End();
                return new Dictionary<string, object> { { "shown", false } };
            }
            throw new Exception("Unknown screen request: " + op);
        }

        /// What every action must pass: an unlocked screen, and a user not using it a moment ago.
        static void Guard()
        {
            if (Locked()) throw new Refusal("locked", LOCKED);
            object idle = UserIdle();
            if (idle != null && Convert.ToInt64(idle) < USER_QUIET_MS)
                throw new Refusal("user-active", "The user is using the computer right now.");
        }

        /* ---------------------------------------------------------------- */
        /* For the overlay and UI Automation                                 */
        /* ---------------------------------------------------------------- */

        public static List<Monitor> AllMonitors() { return Monitors(); }

        public static bool CursorPoint(out POINT point) { return Native.GetCursorPos(out point); }

        public static Dictionary<string, object> BoundsOf(RECT rect) { return Bounds(rect); }

        public static string TextOf(Dictionary<string, object> request, string key) { return Text(request, key); }

        public static int IntOf(Dictionary<string, object> request, string key, int fallback) { return Int(request, key, fallback); }

        public static bool IsProtectedProcess(uint pid, string name)
        {
            return ProtectedPids.Contains(pid) || ProtectedNames.Contains(name ?? "");
        }

        /// A tap of Alt, masked by a key nothing uses so that no menu opens on its release: Windows lets a window be
        /// brought to the front while Alt is down, which `bringForward` does.
        public static void WithAlt(Action bringForward)
        {
            Send(KeyEvent(0x12, false));
            try { bringForward(); }
            finally { Send(Key(0xE8, 0, 0), Key(0xE8, 0, KEYEVENTF_KEYUP), KeyEvent(0x12, true)); }
        }

        /* ---------------------------------------------------------------- */
        /* Reading the request                                               */
        /* ---------------------------------------------------------------- */

        static string Text(Dictionary<string, object> request, string key)
        {
            object value;
            return request.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : "";
        }

        static int Int(Dictionary<string, object> request, string key, int fallback)
        {
            object value;
            if (!request.TryGetValue(key, out value) || value == null) return fallback;
            try { return (int)Math.Round(Convert.ToDouble(value)); } catch { return fallback; }
        }

        /* ---------------------------------------------------------------- */
        /* What is on the screen                                             */
        /* ---------------------------------------------------------------- */

        static List<Monitor> Monitors()
        {
            List<Monitor> found = new List<Monitor>();
            Native.EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr handle, IntPtr hdc, ref RECT rect, IntPtr data)
            {
                MONITORINFOEX info = new MONITORINFOEX();
                info.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
                if (!Native.GetMonitorInfo(handle, ref info)) return true;
                uint dpiX = 96, dpiY = 96;
                try { Native.GetDpiForMonitor(handle, 0, out dpiX, out dpiY); } catch { }
                found.Add(new Monitor { Primary = (info.dwFlags & 1) != 0, Bounds = info.rcMonitor, Work = info.rcWork, Dpi = dpiX });
                return true;
            }, IntPtr.Zero);
            // The main screen first, then the rest from left to right: monitor 1 is the one the user means by "my screen".
            found.Sort(delegate (Monitor a, Monitor b)
            {
                if (a.Primary != b.Primary) return a.Primary ? -1 : 1;
                return a.Bounds.Left != b.Bounds.Left ? a.Bounds.Left.CompareTo(b.Bounds.Left) : a.Bounds.Top.CompareTo(b.Bounds.Top);
            });
            for (int index = 0; index < found.Count; index++) found[index].Index = index + 1;
            return found;
        }

        static Monitor MonitorHolding(int x, int y)
        {
            foreach (Monitor monitor in Monitors())
                if (x >= monitor.Bounds.Left && x < monitor.Bounds.Right && y >= monitor.Bounds.Top && y < monitor.Bounds.Bottom) return monitor;
            return null;
        }

        /// The monitor the window in front mostly sits on: where typing and keys show.
        static Monitor MonitorInFront()
        {
            RECT rect;
            if (Native.GetWindowRect(Native.GetForegroundWindow(), out rect))
            {
                Monitor holding = MonitorHolding((rect.Left + rect.Right) / 2, (rect.Top + rect.Bottom) / 2);
                if (holding != null) return holding;
            }
            List<Monitor> monitors = Monitors();
            return monitors.Count > 0 ? monitors[0] : null;
        }

        static Dictionary<string, object> Bounds(RECT rect)
        {
            return new Dictionary<string, object> { { "left", rect.Left }, { "top", rect.Top }, { "width", rect.Right - rect.Left }, { "height", rect.Bottom - rect.Top } };
        }

        static uint ProcessOf(IntPtr window)
        {
            uint pid;
            Native.GetWindowThreadProcessId(window, out pid);
            return pid;
        }

        static string ProcessName(uint pid)
        {
            try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
        }

        static bool IsProtected(IntPtr window)
        {
            if (window == IntPtr.Zero) return false;
            IntPtr root = Native.GetAncestor(window, GA_ROOT);
            uint pid = ProcessOf(root != IntPtr.Zero ? root : window);
            return ProtectedPids.Contains(pid) || ProtectedNames.Contains(ProcessName(pid));
        }

        static string TitleOf(IntPtr window)
        {
            StringBuilder title = new StringBuilder(512);
            Native.GetWindowText(window, title, title.Capacity);
            return title.ToString();
        }

        static Dictionary<string, object> Foreground()
        {
            IntPtr window = Native.GetForegroundWindow();
            return new Dictionary<string, object> { { "title", TitleOf(window) }, { "process", ProcessName(ProcessOf(window)) }, { "willow", IsProtected(window) } };
        }

        /// A window of a program running as administrator, which Windows keeps the bot's clicks, keys and UI
        /// Automation out of without a word: refused out loud, so the bot asks the user instead of trying again.
        public static void CheckReachable(IntPtr window)
        {
            if (window == IntPtr.Zero) return;
            IntPtr root = Native.GetAncestor(window, GA_ROOT);
            if (root == IntPtr.Zero) root = window;
            if (!Elevation.Above(ProcessOf(root))) return;
            string title = TitleOf(root);
            throw new Refusal("elevated", (title.Length > 0 ? "\"" + title + "\"" : "That window") + " belongs to a program running as administrator, and Windows keeps other programs out of it, so nothing was done. Ask the user to do this part themselves.");
        }

        /// The screen is locked, or Windows is asking something only the user can answer: the lock screen's own window
        /// in front (it is drawn on the ordinary desktop), or the input desktop not "Default" (the sign-in and UAC one).
        static bool Locked()
        {
            string front = ProcessName(ProcessOf(Native.GetForegroundWindow()));
            if (string.Equals(front, "LockApp", StringComparison.OrdinalIgnoreCase) || string.Equals(front, "LogonUI", StringComparison.OrdinalIgnoreCase)) return true;
            IntPtr desktop = Native.OpenInputDesktop(0, false, 0x0001);
            if (desktop == IntPtr.Zero) return true;
            try
            {
                StringBuilder name = new StringBuilder(64);
                int needed;
                if (!Native.GetUserObjectInformation(desktop, 2, name, name.Capacity * 2, out needed)) return false;
                return !string.Equals(name.ToString(), "Default", StringComparison.OrdinalIgnoreCase);
            }
            finally { Native.CloseDesktop(desktop); }
        }

        /// Milliseconds since the user last used the mouse or keyboard themselves; null when they have not since the
        /// helper began watching. Without the watch, a guess: input not just after this process's own.
        static object UserIdle()
        {
            LASTINPUTINFO info = new LASTINPUTINFO();
            info.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
            bool known = Native.GetLastInputInfo(ref info);
            uint now = Native.GetTickCount();
            if (InputWatch.Running)
            {
                long watched = InputWatch.IdleMs();
                if (watched >= 0) return watched;
                // Before the watch began the helper had put nothing in, so what Windows last saw then was the user.
                if (known && unchecked((int)(InputWatch.StartedAt - info.dwTime)) > 0) return (long)unchecked(now - info.dwTime);
                return null;
            }
            if (!known) return null;
            if (lastInjectedAt != 0 && unchecked((int)(info.dwTime - lastInjectedAt)) <= 60) return null;
            return (long)unchecked(now - info.dwTime);
        }

        static Dictionary<string, object> Cursor()
        {
            POINT point;
            Native.GetCursorPos(out point);
            return new Dictionary<string, object> { { "x", point.X }, { "y", point.Y } };
        }

        static object Info()
        {
            List<object> monitors = new List<object>();
            foreach (Monitor monitor in Monitors())
            {
                Dictionary<string, object> entry = Bounds(monitor.Bounds);
                entry["index"] = monitor.Index;
                entry["primary"] = monitor.Primary;
                entry["scale"] = Math.Round(monitor.Dpi / 96.0, 2);
                monitors.Add(entry);
            }
            return new Dictionary<string, object>
            {
                { "monitors", monitors }, { "cursor", Cursor() }, { "foreground", Foreground() },
                { "userIdleMs", UserIdle() }, { "locked", Locked() }, { "watching", InputWatch.Running },
                // What SendInput is told an input's size is: 40 bytes in a 64-bit process, 28 in a 32-bit one.
                { "inputSize", Marshal.SizeOf(typeof(INPUT)) }, { "is64Bit", Environment.Is64BitProcess },
            };
        }

        /* ---------------------------------------------------------------- */
        /* Capturing                                                         */
        /* ---------------------------------------------------------------- */

        static Monitor MonitorAt(int index)
        {
            List<Monitor> monitors = Monitors();
            if (monitors.Count == 0) throw new Exception("No screen was found.");
            if (index <= 0) return monitors[0];
            if (index > monitors.Count) throw new Exception("There is no screen " + index + ": this computer has " + monitors.Count + ".");
            return monitors[index - 1];
        }

        static void DrawCursor(Graphics graphics, RECT bounds)
        {
            CURSORINFO info = new CURSORINFO();
            info.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
            if (!Native.GetCursorInfo(ref info) || (info.flags & 1) == 0 || info.hCursor == IntPtr.Zero) return;
            ICONINFO icon;
            if (!Native.GetIconInfo(info.hCursor, out icon)) return;
            try
            {
                IntPtr hdc = graphics.GetHdc();
                try { Native.DrawIconEx(hdc, info.ptScreenPos.X - bounds.Left - icon.xHotspot, info.ptScreenPos.Y - bounds.Top - icon.yHotspot, info.hCursor, 0, 0, 0, IntPtr.Zero, 3); }
                finally { graphics.ReleaseHdc(hdc); }
            }
            finally
            {
                if (icon.hbmMask != IntPtr.Zero) Native.DeleteObject(icon.hbmMask);
                if (icon.hbmColor != IntPtr.Zero) Native.DeleteObject(icon.hbmColor);
            }
        }

        static object Capture(int index)
        {
            if (Locked()) throw new Refusal("locked", LOCKED);
            Monitor monitor = MonitorAt(index);
            int width = monitor.Bounds.Right - monitor.Bounds.Left;
            int height = monitor.Bounds.Bottom - monitor.Bounds.Top;
            using (Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format24bppRgb))
            {
                using (Graphics graphics = Graphics.FromImage(bitmap))
                {
                    Overlay.Say("is looking at your screen");
                    // Captures leave the overlay out where Windows can (10 2004 on); elsewhere it steps aside for them.
                    bool hide = Overlay.Active && !Overlay.ExcludedFromCapture();
                    if (hide) { Overlay.Hide(true); Pause(60); }
                    try { graphics.CopyFromScreen(monitor.Bounds.Left, monitor.Bounds.Top, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy); }
                    finally { if (hide) Overlay.Hide(false); }
                    DrawCursor(graphics, monitor.Bounds);
                    Overlay.Resting();
                }
                ImageCodecInfo jpeg = null;
                foreach (ImageCodecInfo codec in ImageCodecInfo.GetImageEncoders()) if (codec.MimeType == "image/jpeg") jpeg = codec;
                EncoderParameters parameters = new EncoderParameters(1);
                parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 82L);
                using (MemoryStream stream = new MemoryStream())
                {
                    bitmap.Save(stream, jpeg, parameters);
                    Dictionary<string, object> result = Bounds(monitor.Bounds);
                    result["data"] = Convert.ToBase64String(stream.ToArray());
                    result["monitor"] = monitor.Index;
                    result["monitors"] = Monitors().Count;
                    result["primary"] = monitor.Primary;
                    result["foreground"] = Foreground();
                    result["userIdleMs"] = UserIdle();
                    return result;
                }
            }
        }

        /* ---------------------------------------------------------------- */
        /* Waiting for the screen to settle                                  */
        /* ---------------------------------------------------------------- */

        // How far apart the pixels compared are, how much a pixel must change to count, and how few may change for the
        // screen to count as still: a caret blinking or a spinner turning is less.
        const int SAMPLE_STEP = 6;
        const int PIXEL_CHANGE = 24;
        const double STILL = 0.003;

        /// Waits for what an action set going to finish drawing — a menu opening, a page scrolling, a dialog coming up
        /// — so the bot's next look shows where it ended: until the monitor it acted on holds still between two looks,
        /// or for as long as such things take at most.
        static void Settle(string kind, Monitor monitor)
        {
            int least = kind == "move" ? 150 : 90;
            int most = kind == "click" || kind == "key" ? 1500 : kind == "drag" ? 1200 : kind == "scroll" ? 900 : kind == "type" ? 800 : 700;
            Pause(least);
            if (monitor == null) return;
            // Where captures cannot leave the overlay out, its breathing glow never holds still: a fixed wait instead.
            if (Overlay.Active && !Overlay.ExcludedFromCapture()) { Pause(250); return; }
            int width = monitor.Bounds.Right - monitor.Bounds.Left;
            int height = monitor.Bounds.Bottom - monitor.Bounds.Top;
            if (width <= 0 || height <= 0) return;
            Stopwatch waited = Stopwatch.StartNew();
            byte[] before = null;
            using (Bitmap frame = new Bitmap(width, height, PixelFormat.Format24bppRgb))
            using (Graphics graphics = Graphics.FromImage(frame))
            {
                while (least + waited.ElapsedMilliseconds < most)
                {
                    try { graphics.CopyFromScreen(monitor.Bounds.Left, monitor.Bounds.Top, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy); }
                    catch { return; }
                    byte[] now = Sample(frame);
                    if (before != null && Difference(before, now) <= STILL) return;
                    before = now;
                    Pause(60);
                }
            }
        }

        static byte[] Sample(Bitmap frame)
        {
            int columns = (frame.Width + SAMPLE_STEP - 1) / SAMPLE_STEP;
            int rows = (frame.Height + SAMPLE_STEP - 1) / SAMPLE_STEP;
            byte[] sample = new byte[columns * rows * 3];
            BitmapData data = frame.LockBits(new Rectangle(0, 0, frame.Width, frame.Height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
            try
            {
                byte[] row = new byte[Math.Abs(data.Stride)];
                int at = 0;
                for (int y = 0; y < frame.Height; y += SAMPLE_STEP)
                {
                    Marshal.Copy(new IntPtr(data.Scan0.ToInt64() + (long)y * data.Stride), row, 0, row.Length);
                    for (int x = 0; x < frame.Width; x += SAMPLE_STEP)
                    {
                        sample[at++] = row[x * 3];
                        sample[at++] = row[x * 3 + 1];
                        sample[at++] = row[x * 3 + 2];
                    }
                }
            }
            finally { frame.UnlockBits(data); }
            return sample;
        }

        /// The share of compared pixels that changed between two samples.
        static double Difference(byte[] a, byte[] b)
        {
            if (a.Length != b.Length) return 1;
            int changed = 0;
            for (int index = 0; index + 2 < a.Length; index += 3)
                if (Math.Abs(a[index] - b[index]) > PIXEL_CHANGE || Math.Abs(a[index + 1] - b[index + 1]) > PIXEL_CHANGE || Math.Abs(a[index + 2] - b[index + 2]) > PIXEL_CHANGE) changed++;
            return changed / (double)Math.Max(1, a.Length / 3);
        }

        /* ---------------------------------------------------------------- */
        /* Acting                                                            */
        /* ---------------------------------------------------------------- */

        static INPUT Mouse(uint flags, int data)
        {
            INPUT input = new INPUT();
            input.type = INPUT_MOUSE;
            input.u.mi.dwFlags = flags;
            input.u.mi.mouseData = data;
            return input;
        }

        static INPUT Key(ushort vk, ushort scan, uint flags)
        {
            INPUT input = new INPUT();
            input.type = INPUT_KEYBOARD;
            input.u.ki.wVk = vk;
            input.u.ki.wScan = scan;
            input.u.ki.dwFlags = flags;
            return input;
        }

        static void Send(params INPUT[] inputs)
        {
            if (inputs.Length == 0) return;
            uint sent = Native.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
            lastInjectedAt = Native.GetTickCount();
            if (sent != inputs.Length) throw new Exception("Windows did not take the input: the window may belong to a program running as administrator.");
        }

        static void Pause(int ms)
        {
            Thread.Sleep(ms);
        }

        static void MoveTo(int x, int y)
        {
            InputWatch.Placed(x, y);
            Native.SetCursorPos(x, y);
            lastInjectedAt = Native.GetTickCount();
        }

        /// The pointer to (x, y) as a mouse takes it there — through the input stream, where hover and drag and drop
        /// listen — and then exactly onto that pixel.
        static void Glide(int x, int y)
        {
            int left = Native.GetSystemMetrics(76), top = Native.GetSystemMetrics(77);
            int width = Native.GetSystemMetrics(78), height = Native.GetSystemMetrics(79);
            if (width > 1 && height > 1)
            {
                INPUT move = Mouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, 0);
                move.u.mi.dx = (int)Math.Round((x - left) * 65535.0 / (width - 1));
                move.u.mi.dy = (int)Math.Round((y - top) * 65535.0 / (height - 1));
                InputWatch.Placed(x, y);
                Send(move);
            }
            MoveTo(x, y);
        }

        static readonly Dictionary<string, ushort> Keys = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase)
        {
            { "enter", 0x0D }, { "return", 0x0D }, { "esc", 0x1B }, { "escape", 0x1B }, { "tab", 0x09 }, { "space", 0x20 }, { "spacebar", 0x20 },
            { "backspace", 0x08 }, { "back", 0x08 }, { "delete", 0x2E }, { "del", 0x2E }, { "forwarddelete", 0x2E }, { "insert", 0x2D }, { "ins", 0x2D },
            { "home", 0x24 }, { "end", 0x23 }, { "pageup", 0x21 }, { "pgup", 0x21 }, { "pagedown", 0x22 }, { "pgdn", 0x22 }, { "pgdown", 0x22 },
            { "up", 0x26 }, { "down", 0x28 }, { "left", 0x25 }, { "right", 0x27 },
            { "arrowup", 0x26 }, { "arrowdown", 0x28 }, { "arrowleft", 0x25 }, { "arrowright", 0x27 },
            { "menu", 0x5D }, { "apps", 0x5D }, { "contextmenu", 0x5D }, { "capslock", 0x14 }, { "printscreen", 0x2C }, { "prtsc", 0x2C },
            { "pause", 0x13 }, { "break", 0x13 }, { "numlock", 0x90 }, { "scrolllock", 0x91 },
            { "ctrl", 0x11 }, { "control", 0x11 }, { "shift", 0x10 }, { "alt", 0x12 }, { "option", 0x12 },
            { "win", 0x5B }, { "windows", 0x5B }, { "super", 0x5B }, { "meta", 0x5B }, { "lwin", 0x5B }, { "rwin", 0x5C },
            // A Mac's command key is Windows' Control: cmd+c copies here as it does there.
            { "cmd", 0x11 }, { "command", 0x11 },
            { "lshift", 0xA0 }, { "rshift", 0xA1 }, { "lctrl", 0xA2 }, { "rctrl", 0xA3 }, { "lalt", 0xA4 }, { "ralt", 0xA5 },
            { "numpad0", 0x60 }, { "numpad1", 0x61 }, { "numpad2", 0x62 }, { "numpad3", 0x63 }, { "numpad4", 0x64 },
            { "numpad5", 0x65 }, { "numpad6", 0x66 }, { "numpad7", 0x67 }, { "numpad8", 0x68 }, { "numpad9", 0x69 },
            { "multiply", 0x6A }, { "numpadmultiply", 0x6A }, { "add", 0x6B }, { "numpadadd", 0x6B }, { "subtract", 0x6D }, { "numpadsubtract", 0x6D },
            { "decimal", 0x6E }, { "numpaddecimal", 0x6E }, { "divide", 0x6F }, { "numpaddivide", 0x6F },
            { "volumemute", 0xAD }, { "mute", 0xAD }, { "volumedown", 0xAE }, { "volumeup", 0xAF },
            { "medianext", 0xB0 }, { "nexttrack", 0xB0 }, { "mediaprevious", 0xB1 }, { "mediaprev", 0xB1 }, { "previoustrack", 0xB1 }, { "prevtrack", 0xB1 },
            { "mediastop", 0xB2 }, { "mediaplaypause", 0xB3 }, { "playpause", 0xB3 }, { "mediaplay", 0xB3 },
            { "browserback", 0xA6 }, { "browserforward", 0xA7 }, { "browserrefresh", 0xA8 }, { "browserstop", 0xA9 },
            { "browsersearch", 0xAA }, { "browserfavorites", 0xAB }, { "browserhome", 0xAC },
        };
        // Keys named by the character they make, found on the keyboard in use like any character.
        static readonly Dictionary<string, char> Characters = new Dictionary<string, char>(StringComparer.OrdinalIgnoreCase)
        {
            { "plus", '+' }, { "minus", '-' }, { "hyphen", '-' }, { "comma", ',' }, { "period", '.' }, { "dot", '.' }, { "slash", '/' },
            { "backslash", '\\' }, { "semicolon", ';' }, { "colon", ':' }, { "quote", '\'' }, { "apostrophe", '\'' }, { "doublequote", '"' },
            { "backquote", '`' }, { "backtick", '`' }, { "grave", '`' }, { "tilde", '~' }, { "equal", '=' }, { "equals", '=' }, { "underscore", '_' },
            { "bracketleft", '[' }, { "leftbracket", '[' }, { "bracketright", ']' }, { "rightbracket", ']' }, { "braceleft", '{' }, { "braceright", '}' },
            { "question", '?' }, { "exclamation", '!' }, { "at", '@' }, { "hash", '#' }, { "dollar", '$' }, { "percent", '%' }, { "caret", '^' },
            { "ampersand", '&' }, { "asterisk", '*' }, { "star", '*' }, { "parenleft", '(' }, { "parenright", ')' }, { "pipe", '|' },
            { "less", '<' }, { "greater", '>' },
        };
        static readonly HashSet<ushort> Extended = new HashSet<ushort>
        {
            0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2C, 0x2D, 0x2E, 0x5B, 0x5C, 0x5D, 0x6F, 0x90, 0xA3, 0xA5,
            0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF, 0xB0, 0xB1, 0xB2, 0xB3,
        };
        static readonly HashSet<ushort> Modifiers = new HashSet<ushort> { 0x10, 0x11, 0x12, 0x5B, 0x5C, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5 };

        /// The keyboard layout of the window in front, where the keys go: which key makes a character depends on it.
        static IntPtr LayoutInFront()
        {
            uint pid;
            uint thread = Native.GetWindowThreadProcessId(Native.GetForegroundWindow(), out pid);
            return thread == 0 ? IntPtr.Zero : Native.GetKeyboardLayout(thread);
        }

        /// The virtual key for one part of a combination, and the modifiers its character needs on `layout` (1 Shift,
        /// 2 Ctrl, 4 Alt): "?" is Shift and the slash key on most keyboards.
        static ushort VirtualKey(string name, IntPtr layout, bool alone, out int needs)
        {
            needs = 0;
            ushort vk;
            if (Keys.TryGetValue(name, out vk)) return vk;
            char named;
            string text = Characters.TryGetValue(name, out named) ? named.ToString() : name;
            if (text.Length > 1 && (text[0] == 'f' || text[0] == 'F'))
            {
                int number;
                if (int.TryParse(text.Substring(1), out number) && number >= 1 && number <= 24) return (ushort)(0x6F + number);
            }
            if (text.Length == 1)
            {
                char character = text[0];
                if ((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z')) return (ushort)char.ToUpperInvariant(character);
                if (character >= '0' && character <= '9') return (ushort)character;
                short scan = layout == IntPtr.Zero ? Native.VkKeyScan(character) : Native.VkKeyScanEx(character, layout);
                if (scan != -1 && (scan & 0xFF) != 0xFF)
                {
                    needs = (scan >> 8) & 0x07;
                    return (ushort)(scan & 0xFF);
                }
                throw new NotOnLayout(character, alone);
            }
            throw new Exception("\"" + name + "\" is not a key Windows knows. Use a key name such as Enter, Escape, Tab, Up, PageDown or F5, or a single character.");
        }

        /// The keys a combination such as "ctrl+shift+t" presses, modifiers first, with those its last key's character
        /// needs added: "ctrl+?" presses Ctrl, Shift and the slash key.
        static List<ushort> Combination(string text)
        {
            string trimmed = text.Trim();
            if (trimmed.Length == 0) throw new Exception("Give the \"key\" to press.");
            List<string> parts = new List<string>();
            if (trimmed == "+") parts.Add("+");
            else
            {
                foreach (string part in trimmed.Split('+')) if (part.Trim().Length > 0) parts.Add(part.Trim());
                if (trimmed.EndsWith("++")) parts.Add("+");
            }
            IntPtr layout = LayoutInFront();
            List<ushort> keys = new List<ushort>();
            for (int index = 0; index < parts.Count; index++)
            {
                int needs;
                ushort vk = VirtualKey(parts[index], layout, parts.Count == 1, out needs);
                if (index == parts.Count - 1)
                {
                    if ((needs & 2) != 0 && !keys.Contains(0x11)) keys.Add(0x11);
                    if ((needs & 4) != 0 && !keys.Contains(0x12)) keys.Add(0x12);
                    if ((needs & 1) != 0 && !keys.Contains(0x10)) keys.Add(0x10);
                }
                if (!keys.Contains(vk)) keys.Add(vk);
            }
            return keys;
        }

        static Dictionary<string, object> KeyPlan(string text)
        {
            try
            {
                List<object> keys = new List<object>();
                foreach (ushort vk in Combination(text)) keys.Add((int)vk);
                return new Dictionary<string, object> { { "keys", keys } };
            }
            catch (NotOnLayout missing)
            {
                return new Dictionary<string, object> { { "character", missing.Character.ToString() }, { "alone", missing.Alone } };
            }
            catch (Exception error)
            {
                return new Dictionary<string, object> { { "error", error.Message } };
            }
        }

        static INPUT KeyEvent(ushort vk, bool up)
        {
            return Key(vk, 0, (Extended.Contains(vk) ? KEYEVENTF_EXTENDEDKEY : 0) | (up ? KEYEVENTF_KEYUP : 0));
        }

        static void Press(List<ushort> keys)
        {
            List<INPUT> inputs = new List<INPUT>();
            foreach (ushort vk in keys) inputs.Add(KeyEvent(vk, false));
            for (int index = keys.Count - 1; index >= 0; index--) inputs.Add(KeyEvent(keys[index], true));
            Send(inputs.ToArray());
        }

        /// Typing, a character at a time, until the user takes the keyboard or the mouse, or stops the bot: then it
        /// stops where it got to, rather than mix the bot's letters with theirs, and says how far.
        static void TypeText(string text)
        {
            string flat = text.Replace("\r\n", "\n").Replace('\r', '\n');
            uint started = Native.GetTickCount();
            // The overlay keeps the Esc that stops the bot to itself, so a stop is seen there rather than as a key.
            bool shown = Overlay.Active;
            for (int index = 0; index < flat.Length; index++)
            {
                if (shown && !Overlay.Active) throw new Refusal("interrupted", "The user stopped you using their screen while you were typing, after " + index + " of " + flat.Length + " characters. Leave their screen alone unless they ask you to use it again.");
                if (InputWatch.PressedSince(started)) throw Interrupted(flat, index);
                char character = flat[index];
                if (character == '\n') Send(KeyEvent(0x0D, false), KeyEvent(0x0D, true));
                else if (character == '\t') Send(KeyEvent(0x09, false), KeyEvent(0x09, true));
                else if (char.IsHighSurrogate(character) && index + 1 < flat.Length && char.IsLowSurrogate(flat[index + 1]))
                {
                    // Both halves of a character beyond the first 65,536 — most emoji — go in together.
                    char low = flat[index + 1];
                    Send(Key(0, character, KEYEVENTF_UNICODE), Key(0, character, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP), Key(0, low, KEYEVENTF_UNICODE), Key(0, low, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
                    index++;
                }
                else Send(Key(0, character, KEYEVENTF_UNICODE), Key(0, character, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
                Pause(4);
            }
        }

        static Refusal Interrupted(string text, int typed)
        {
            string done = text.Substring(0, typed);
            string tail = done.Length > 30 ? "…" + done.Substring(done.Length - 30) : done;
            return new Refusal("interrupted", "The user started using the keyboard or mouse while you were typing, so the typing stopped after " + typed + " of " + text.Length + " characters" + (typed > 0 ? ", ending \"" + tail + "\"" : "") + ". Wait for them to finish, look at the screen, and type only what is missing.");
        }

        static uint[] Buttons(string name)
        {
            if (name == "" || name == "left") return new uint[] { MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP };
            if (name == "right") return new uint[] { MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP };
            if (name == "middle") return new uint[] { MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP };
            throw new Exception("\"button\" is left, right or middle.");
        }

        static List<ushort> Held(Dictionary<string, object> request)
        {
            List<ushort> held = new List<ushort>();
            string text = Text(request, "hold");
            if (text.Trim().Length == 0) return held;
            foreach (ushort vk in Combination(text))
            {
                if (!Modifiers.Contains(vk)) throw new Exception("Only ctrl, shift, alt and win can be held through a click.");
                if (!held.Contains(vk)) held.Add(vk);
            }
            return held;
        }

        /// A point the bot acts at: on a screen, not on Willow, and — when `reach` — not on a window Windows keeps the
        /// bot out of. The overlay's pill steps aside first if it stands there.
        static void CheckPoint(int x, int y, bool reach)
        {
            if (MonitorHolding(x, y) == null) throw new Exception("(" + x + ", " + y + ") is not on any screen.");
            Overlay.KeepClear(x, y);
            POINT point = new POINT { X = x, Y = y };
            IntPtr hit = Native.WindowFromPoint(point);
            IntPtr root = hit == IntPtr.Zero ? IntPtr.Zero : Native.GetAncestor(hit, GA_ROOT);
            if (Overlay.IsPill(root))
                throw new Refusal("willow", "That point is on Willow's pill, with its Stop button, which a bot never clicks.");
            // The overlay's glow and cursor let clicks through; what counts is the window beneath them.
            if (Overlay.IsOurs(root)) hit = WindowBeneath(point);
            if (IsProtected(hit))
                throw new Refusal("willow", "That point is on Willow's own window, which a bot never clicks.");
            if (reach) CheckReachable(hit);
        }

        static IntPtr WindowBeneath(POINT point)
        {
            IntPtr found = IntPtr.Zero;
            UiNative.EnumWindows(delegate (IntPtr window, IntPtr data)
            {
                if (Overlay.IsOurs(window) || !UiNative.IsWindowVisible(window) || UiNative.IsIconic(window)) return true;
                int extended = UiNative.GetWindowLong(window, -20);
                if ((extended & 0x00000020) != 0 && (extended & 0x00080000) != 0) return true;
                RECT rect;
                if (!UiNative.GetWindowRect(window, out rect)) return true;
                if (point.X >= rect.Left && point.X < rect.Right && point.Y >= rect.Top && point.Y < rect.Bottom) { found = window; return false; }
                return true;
            }, IntPtr.Zero);
            return found;
        }

        /// The bot's cursor on the overlay travels to (x, y) and the pill says what it is doing; the action waits
        /// for it to arrive, then checks again that the user has not come back to the computer meanwhile — and that
        /// the point is still one to act at.
        static void Approach(int x, int y, string doing, bool press, bool reach)
        {
            if (!Overlay.Active) return;
            Overlay.MoveTo(x, y, doing, press);
            Overlay.WaitArrived(700);
            Guard();
            CheckPoint(x, y, reach);
        }

        /// Win-key shortcuts and Alt+Tab go to Windows itself, not the window in front, so they are safe with Willow there.
        static bool ForWindows(List<ushort> keys)
        {
            if (keys.Contains(0x5B) || keys.Contains(0x5C)) return true;
            return keys.Count == 2 && keys.Contains(0x12) && (keys.Contains(0x09) || keys.Contains(0x1B));
        }

        static object Act(Dictionary<string, object> request)
        {
            Guard();
            string grant = Text(request, "grant");
            if (grant.Length > 0 && grant == Overlay.StoppedGrant)
                throw new Refusal("stopped", "The user stopped you using their screen.");
            try { return Perform(request); }
            finally { Overlay.Resting(); }
        }

        static object Perform(Dictionary<string, object> request)
        {
            string kind = Text(request, "kind");
            int x = Int(request, "x", int.MinValue);
            int y = Int(request, "y", int.MinValue);
            bool pointing = kind == "click" || kind == "move" || kind == "scroll" || kind == "drag";
            if (pointing)
            {
                if (x == int.MinValue || y == int.MinValue) throw new Exception("Give \"x\" and \"y\".");
                CheckPoint(x, y, kind != "move");
            }
            if (kind == "click")
            {
                uint[] button = Buttons(Text(request, "button").ToLowerInvariant());
                int clicks = Math.Max(1, Math.Min(3, Int(request, "clicks", 1)));
                List<ushort> held = Held(request);
                Approach(x, y, clicks == 2 ? "is double-clicking" : "is clicking", true, true);
                Glide(x, y);
                Pause(40);
                foreach (ushort vk in held) Send(KeyEvent(vk, false));
                try
                {
                    for (int index = 0; index < clicks; index++)
                    {
                        Send(Mouse(button[0], 0));
                        Pause(25);
                        Send(Mouse(button[1], 0));
                        if (index + 1 < clicks) Pause(70);
                    }
                }
                finally
                {
                    for (int index = held.Count - 1; index >= 0; index--) Send(KeyEvent(held[index], true));
                }
            }
            else if (kind == "move")
            {
                Approach(x, y, "is pointing", false, false);
                Glide(x, y);
            }
            else if (kind == "scroll")
            {
                int deltaY = Int(request, "deltaY", 0);
                int deltaX = Int(request, "deltaX", 0);
                if (deltaY == 0 && deltaX == 0) throw new Exception("Give \"deltaY\": pixels to scroll down, or up when negative.");
                Approach(x, y, "is scrolling", false, true);
                Glide(x, y);
                Pause(40);
                int notchesY = deltaY == 0 ? 0 : Math.Max(1, Math.Min(50, (int)Math.Round(Math.Abs(deltaY) / 100.0)));
                int notchesX = deltaX == 0 ? 0 : Math.Max(1, Math.Min(50, (int)Math.Round(Math.Abs(deltaX) / 100.0)));
                for (int index = 0; index < notchesY; index++) { Send(Mouse(MOUSEEVENTF_WHEEL, deltaY > 0 ? -120 : 120)); Pause(15); }
                for (int index = 0; index < notchesX; index++) { Send(Mouse(MOUSEEVENTF_HWHEEL, deltaX > 0 ? 120 : -120)); Pause(15); }
            }
            else if (kind == "drag")
            {
                int toX = Int(request, "toX", int.MinValue);
                int toY = Int(request, "toY", int.MinValue);
                if (toX == int.MinValue || toY == int.MinValue) throw new Exception("Give \"toX\" and \"toY\".");
                CheckPoint(toX, toY, true);
                Approach(x, y, "is dragging", true, true);
                Glide(x, y);
                Pause(60);
                Overlay.MoveTo(toX, toY, "is dragging", false);
                Send(Mouse(MOUSEEVENTF_LEFTDOWN, 0));
                try
                {
                    for (int step = 1; step <= 12; step++)
                    {
                        Pause(16);
                        Glide(x + (toX - x) * step / 12, y + (toY - y) * step / 12);
                    }
                    // A last stir where it is dropped, which drop targets wait for before they take it.
                    Pause(40);
                    Glide(toX + 1, toY);
                    Pause(20);
                    Glide(toX, toY);
                    Pause(80);
                }
                finally { Send(Mouse(MOUSEEVENTF_LEFTUP, 0)); }
            }
            else if (kind == "type" || kind == "key")
            {
                IntPtr front = Native.GetForegroundWindow();
                List<ushort> keys = null;
                string character = null;
                if (kind == "key")
                {
                    try { keys = Combination(Text(request, "key")); }
                    catch (NotOnLayout missing)
                    {
                        if (!missing.Alone) throw;
                        // A character this keyboard has no key for goes in as typing does.
                        character = missing.Character.ToString();
                    }
                }
                bool toWindows = keys != null && ForWindows(keys);
                if (IsProtected(front) && !toWindows)
                    throw new Refusal("willow-focus", "Willow's own window is in front, and a bot never types into it.");
                if (!toWindows) CheckReachable(front);
                if (kind == "type")
                {
                    string text = Text(request, "text");
                    if (text.Length == 0) throw new Exception("Give the \"text\" to type.");
                    if (text.Length > 5000) throw new Exception("Type at most 5,000 characters at a time.");
                    Overlay.Say("is typing");
                    TypeText(text);
                }
                else if (character != null)
                {
                    Overlay.Say("is typing");
                    TypeText(character);
                }
                else
                {
                    Overlay.Say("is pressing " + Text(request, "key").Trim());
                    Press(keys);
                }
            }
            else throw new Exception("Unknown action: " + kind);
            Settle(kind, pointing ? MonitorHolding(x, y) : MonitorInFront());
            return new Dictionary<string, object> { { "cursor", Cursor() }, { "foreground", Foreground() } };
        }
    }
}
