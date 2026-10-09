// Willow's eyes and hands on the user's own screen (screen.mjs): one process, a JSON request per line on stdin and a
// JSON answer per line on stdout. Compiled by the companion with the .NET Framework's own C# 5 compiler, and declared
// per-monitor DPI aware in its manifest, so what it captures and where it clicks are the screen's real pixels.
//
// It never acts on Willow's own windows — a bot must not be able to approve its own requests — and it holds off while
// the user is using the computer: any input of theirs since its own last action, a moment ago, refuses the next one.
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

    delegate bool MonitorEnumProc(IntPtr monitor, IntPtr hdc, ref RECT rect, IntPtr data);

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
        [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
        [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc callback, IntPtr data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFOEX info);
        [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);
        [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO info);
        [DllImport("user32.dll")] public static extern bool GetIconInfo(IntPtr icon, out ICONINFO info);
        [DllImport("user32.dll")] public static extern bool DrawIconEx(IntPtr hdc, int x, int y, IntPtr icon, int width, int height, int step, IntPtr brush, int flags);
        [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr handle);
        [DllImport("user32.dll")] public static extern short VkKeyScan(char character);
        [DllImport("kernel32.dll")] public static extern uint GetTickCount();
        [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
        [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder info, int length, out int needed);
    }

    class Refusal : Exception
    {
        public readonly string Reason;
        public Refusal(string reason, string message) : base(message) { Reason = reason; }
    }

    class Monitor
    {
        public int Index;
        public bool Primary;
        public RECT Bounds;
        public uint Dpi;
    }

    static class Program
    {
        const uint INPUT_MOUSE = 0;
        const uint INPUT_KEYBOARD = 1;
        const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        const uint MOUSEEVENTF_LEFTUP = 0x0004;
        const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        const uint MOUSEEVENTF_WHEEL = 0x0800;
        const uint MOUSEEVENTF_HWHEEL = 0x1000;
        const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        const uint KEYEVENTF_KEYUP = 0x0002;
        const uint KEYEVENTF_UNICODE = 0x0004;
        const uint GA_ROOT = 2;

        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 16 };
        // Answers and the overlay's events share stdout, one whole line at a time.
        static readonly object OutputLock = new object();
        static TextWriter output;
        static readonly HashSet<string> ProtectedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        static readonly HashSet<uint> ProtectedPids = new HashSet<uint>();
        // When this process last finished putting input in: input after it, but not from it, is the user's.
        static uint lastInjectedAt;
        // How recent the user's own input must be to hold the next action off.
        const uint USER_QUIET_MS = 1500;

        [STAThread]
        static int Main(string[] args)
        {
            try { Native.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
            // Draws the overlay's parts to files and stops: how it looks, checked where captures leave it out.
            for (int index = 0; index + 1 < args.Length; index++)
            {
                if (args[index] != "--render-samples") continue;
                Overlay.RenderSamples(args[index + 1], index + 2 < args.Length ? args[index + 2] : "Pip", index + 3 < args.Length ? args[index + 3] : "");
                return 0;
            }
            for (int index = 0; index + 1 < args.Length; index += 2)
            {
                if (args[index] == "--protect-name") ProtectedNames.Add(args[index + 1]);
                else if (args[index] == "--protect-pid") { uint pid; if (uint.TryParse(args[index + 1], out pid)) ProtectedPids.Add(pid); }
            }
            ProtectedNames.Add("willow-desktop");
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
                if (Locked()) throw new Refusal("locked", "The screen is locked, or Windows is showing a prompt that only the user can answer.");
                return UiAutomation.Elements(request);
            }
            if (op == "element") { Guard(); return UiAutomation.Act(request); }
            if (op == "focus") { Guard(); return UiAutomation.Focus(request); }
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
            if (Locked()) throw new Refusal("locked", "The screen is locked, or Windows is showing a prompt that only the user can answer.");
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
                found.Add(new Monitor { Primary = (info.dwFlags & 1) != 0, Bounds = info.rcMonitor, Dpi = dpiX });
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

        /// Milliseconds since the user last used the mouse or keyboard themselves, as far as anyone can tell: input
        /// after this process last put some in. Null when there has been none since.
        static object UserIdle()
        {
            LASTINPUTINFO info = new LASTINPUTINFO();
            info.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
            if (!Native.GetLastInputInfo(ref info)) return null;
            uint now = Native.GetTickCount();
            // Input no later than just after this process's own last input was its own.
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
                { "userIdleMs", UserIdle() }, { "locked", Locked() },
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
            if (Locked()) throw new Refusal("locked", "The screen is locked, or Windows is showing a prompt that only the user can answer.");
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
            Native.SetCursorPos(x, y);
            lastInjectedAt = Native.GetTickCount();
        }

        static readonly Dictionary<string, ushort> Keys = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase)
        {
            { "enter", 0x0D }, { "return", 0x0D }, { "esc", 0x1B }, { "escape", 0x1B }, { "tab", 0x09 }, { "space", 0x20 }, { "spacebar", 0x20 },
            { "backspace", 0x08 }, { "delete", 0x2E }, { "del", 0x2E }, { "insert", 0x2D }, { "home", 0x24 }, { "end", 0x23 },
            { "pageup", 0x21 }, { "pagedown", 0x22 }, { "up", 0x26 }, { "down", 0x28 }, { "left", 0x25 }, { "right", 0x27 },
            { "arrowup", 0x26 }, { "arrowdown", 0x28 }, { "arrowleft", 0x25 }, { "arrowright", 0x27 }, { "menu", 0x5D }, { "apps", 0x5D },
            { "capslock", 0x14 }, { "printscreen", 0x2C }, { "pause", 0x13 }, { "numlock", 0x90 }, { "scrolllock", 0x91 },
            { "ctrl", 0x11 }, { "control", 0x11 }, { "shift", 0x10 }, { "alt", 0x12 }, { "option", 0x12 }, { "win", 0x5B }, { "windows", 0x5B },
            { "super", 0x5B }, { "meta", 0x5B }, { "cmd", 0x5B }, { "command", 0x5B },
        };
        static readonly HashSet<ushort> Extended = new HashSet<ushort> { 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B, 0x5D, 0x90, 0x2C };
        static readonly HashSet<ushort> Modifiers = new HashSet<ushort> { 0x10, 0x11, 0x12, 0x5B };

        static ushort VirtualKey(string name)
        {
            ushort vk;
            if (Keys.TryGetValue(name, out vk)) return vk;
            if (name.Length > 1 && (name[0] == 'f' || name[0] == 'F'))
            {
                int number;
                if (int.TryParse(name.Substring(1), out number) && number >= 1 && number <= 24) return (ushort)(0x6F + number);
            }
            if (name.Length == 1)
            {
                char character = name[0];
                if (char.IsLetter(character) && character < 128) return (ushort)char.ToUpperInvariant(character);
                if (char.IsDigit(character)) return (ushort)character;
                short scan = Native.VkKeyScan(character);
                if (scan != -1) return (ushort)(scan & 0xFF);
            }
            throw new Exception("\"" + name + "\" is not a key Windows knows. Use a key name such as Enter, Escape, Tab, Up or F5, or a single letter or digit.");
        }

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
            List<ushort> keys = new List<ushort>();
            foreach (string part in parts) keys.Add(VirtualKey(part));
            return keys;
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

        static void TypeText(string text)
        {
            foreach (char character in text.Replace("\r\n", "\n").Replace('\r', '\n'))
            {
                if (character == '\n') Send(KeyEvent(0x0D, false), KeyEvent(0x0D, true));
                else if (character == '\t') Send(KeyEvent(0x09, false), KeyEvent(0x09, true));
                else Send(Key(0, character, KEYEVENTF_UNICODE), Key(0, character, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
                Pause(4);
            }
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

        static void CheckPoint(int x, int y)
        {
            bool inside = false;
            foreach (Monitor monitor in Monitors())
                if (x >= monitor.Bounds.Left && x < monitor.Bounds.Right && y >= monitor.Bounds.Top && y < monitor.Bounds.Bottom) inside = true;
            if (!inside) throw new Exception("(" + x + ", " + y + ") is not on any screen.");
            POINT point = new POINT { X = x, Y = y };
            IntPtr hit = Native.WindowFromPoint(point);
            IntPtr root = hit == IntPtr.Zero ? IntPtr.Zero : Native.GetAncestor(hit, GA_ROOT);
            if (Overlay.IsPill(root))
                throw new Refusal("willow", "That point is on Willow's pill at the top of the screen, with its Stop button, which a bot never clicks.");
            // The overlay's glow and cursor let clicks through; what counts is the window beneath them.
            if (Overlay.IsOurs(root)) hit = WindowBeneath(point);
            if (IsProtected(hit))
                throw new Refusal("willow", "That point is on Willow's own window, which a bot never clicks.");
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
        /// for it to arrive, then checks again that the user has not come back to the computer meanwhile.
        static void Approach(int x, int y, string doing, bool press)
        {
            if (!Overlay.Active) return;
            Overlay.MoveTo(x, y, doing, press);
            Overlay.WaitArrived(700);
            Guard();
        }

        /// Win-key shortcuts and Alt+Tab go to Windows itself, not the window in front, so they are safe with Willow there.
        static bool ForWindows(List<ushort> keys)
        {
            if (keys.Contains(0x5B)) return true;
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
            if (kind == "click" || kind == "move" || kind == "scroll" || kind == "drag")
            {
                if (x == int.MinValue || y == int.MinValue) throw new Exception("Give \"x\" and \"y\".");
                CheckPoint(x, y);
            }
            if (kind == "click")
            {
                uint[] button = Buttons(Text(request, "button").ToLowerInvariant());
                int clicks = Math.Max(1, Math.Min(3, Int(request, "clicks", 1)));
                List<ushort> held = Held(request);
                Approach(x, y, clicks == 2 ? "is double-clicking" : "is clicking", true);
                MoveTo(x, y);
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
                Approach(x, y, "is pointing", false);
                MoveTo(x, y);
            }
            else if (kind == "scroll")
            {
                int deltaY = Int(request, "deltaY", 0);
                int deltaX = Int(request, "deltaX", 0);
                if (deltaY == 0 && deltaX == 0) throw new Exception("Give \"deltaY\": pixels to scroll down, or up when negative.");
                Approach(x, y, "is scrolling", false);
                MoveTo(x, y);
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
                CheckPoint(toX, toY);
                Approach(x, y, "is dragging", true);
                MoveTo(x, y);
                Pause(60);
                Overlay.MoveTo(toX, toY, "is dragging", false);
                Send(Mouse(MOUSEEVENTF_LEFTDOWN, 0));
                try
                {
                    for (int step = 1; step <= 12; step++)
                    {
                        Pause(16);
                        MoveTo(x + (toX - x) * step / 12, y + (toY - y) * step / 12);
                    }
                    Pause(80);
                }
                finally { Send(Mouse(MOUSEEVENTF_LEFTUP, 0)); }
            }
            else if (kind == "type" || kind == "key")
            {
                IntPtr front = Native.GetForegroundWindow();
                List<ushort> keys = kind == "key" ? Combination(Text(request, "key")) : null;
                if (IsProtected(front) && !(keys != null && ForWindows(keys)))
                    throw new Refusal("willow-focus", "Willow's own window is in front, and a bot never types into it.");
                if (kind == "type")
                {
                    string text = Text(request, "text");
                    if (text.Length == 0) throw new Exception("Give the \"text\" to type.");
                    if (text.Length > 5000) throw new Exception("Type at most 5,000 characters at a time.");
                    Overlay.Say("is typing");
                    TypeText(text);
                }
                else
                {
                    Overlay.Say("is pressing " + Text(request, "key").Trim());
                    Press(keys);
                }
            }
            else throw new Exception("Unknown action: " + kind);
            Pause(kind == "type" || kind == "key" ? 120 : 60);
            return new Dictionary<string, object> { { "cursor", Cursor() }, { "foreground", Foreground() } };
        }
    }
}
