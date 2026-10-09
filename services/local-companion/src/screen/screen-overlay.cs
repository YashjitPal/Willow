// What the user sees while a bot uses their screen (screen-helper.cs): a glow around the edge of every monitor, a pill at
// the top saying which bot is at the controls — its Stop button, and Esc from anywhere, end that at once — and the
// bot's own cursor, which travels to each place it acts and shows it pressing there.
//
// It comes and goes in motion, never all at once: the glow blooms in from nothing and then breathes, the pill drops into
// place a beat later and settles, and the cursor grows out of the user's own pointer. Going, the pill lifts away first
// and the rest sinks out. A fade called back half way — the bot acting again — rises again from where it had got to.
//
// Everything is drawn with GDI+ into layered windows in the screen's real pixels, so it sits exactly on every monitor
// whatever its scaling. The windows never take the focus, are kept out of screen captures (the bot never sees its own
// overlay), and — but for the pill — let the mouse through; the pill's shadow is a window of its own for that reason.
// The user's input is never blocked: the helper already holds off while they use the computer. Esc is watched with a
// low-level keyboard hook only while the overlay shows, and only the user's own key counts — the bot pressing Escape in
// an app is flagged injected, and goes through as itself.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace WillowScreen
{
    [StructLayout(LayoutKind.Sequential)]
    struct SIZE { public int cx; public int cy; }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    struct BLENDFUNCTION { public byte BlendOp; public byte BlendFlags; public byte SourceConstantAlpha; public byte AlphaFormat; }

    [StructLayout(LayoutKind.Sequential)]
    struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }

    delegate IntPtr LowLevelKeyboardProc(int code, IntPtr wParam, IntPtr lParam);

    static class OverlayNative
    {
        [DllImport("user32.dll", SetLastError = true)] public static extern bool UpdateLayeredWindow(IntPtr window, IntPtr screenDc, ref POINT at, ref SIZE size, IntPtr sourceDc, ref POINT source, int key, ref BLENDFUNCTION blend, int flags);
        [DllImport("user32.dll", EntryPoint = "UpdateLayeredWindow", SetLastError = true)] public static extern bool UpdateLayeredOpacity(IntPtr window, IntPtr screenDc, IntPtr at, IntPtr size, IntPtr sourceDc, IntPtr source, int key, ref BLENDFUNCTION blend, int flags);
        [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr window);
        [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr window, IntPtr dc);
        [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr dc);
        [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr dc);
        [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr dc, IntPtr value);
        [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr value);
        [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr window, uint affinity);
        [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SetWindowsHookEx(int kind, LowLevelKeyboardProc proc, IntPtr module, uint thread);
        [DllImport("user32.dll")] public static extern bool UnhookWindowsHookEx(IntPtr hook);
        [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr GetModuleHandle(string name);
    }

    /// The spring the cursor moves by (a damped harmonic oscillator, integrated implicitly so it never blows up): how
    /// quickly it answers (`response`, seconds) and how little it overshoots (`damping`, 1 being none).
    class Spring
    {
        public double Value, Target, Velocity;
        readonly double damping, response;

        public Spring(double value, double damping, double response)
        {
            Value = value;
            Target = value;
            this.damping = damping;
            this.response = response;
        }

        public void Reset(double value)
        {
            Value = value;
            Target = value;
            Velocity = 0;
        }

        /// Moves on by `dt` seconds; false once it has come to rest.
        public bool Step(double dt)
        {
            double omega = 2.0 * Math.PI / response;
            double f = 1.0 + 2.0 * dt * damping * omega;
            double hoo = dt * omega * omega;
            double hhoo = dt * hoo;
            double inverse = 1.0 / (f + hhoo);
            double next = (f * Value + dt * Velocity + hhoo * Target) * inverse;
            Velocity = (Velocity + hoo * (Target - Value)) * inverse;
            Value = next;
            if (Math.Abs(Velocity) < 0.01 && Math.Abs(Value - Target) < 0.01)
            {
                Value = Target;
                Velocity = 0;
                return false;
            }
            return true;
        }
    }

    /// A window drawn entirely by the overlay: per-pixel alpha, never activated, kept out of captures.
    class LayerWindow : Form
    {
        readonly bool passThrough;
        public bool Excluded;

        public LayerWindow(bool passThrough)
        {
            this.passThrough = passThrough;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            AutoScaleMode = AutoScaleMode.None;
            Text = "Willow";
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams parameters = base.CreateParams;
                // Layered, a tool window (no taskbar button, no Alt+Tab), never activated, above everything.
                parameters.ExStyle |= 0x00080000 | 0x00000080 | 0x08000000 | 0x00000008;
                if (passThrough) parameters.ExStyle |= 0x00000020;
                return parameters;
            }
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            // WDA_EXCLUDEFROMCAPTURE (Windows 10 2004 and later): shown on the monitor, absent from every capture.
            try { Excluded = OverlayNative.SetWindowDisplayAffinity(Handle, 0x11); } catch { Excluded = false; }
        }

        protected override void WndProc(ref Message message)
        {
            // WM_MOUSEACTIVATE: answered MA_NOACTIVATE, so pressing Stop leaves the focus where it was.
            if (message.Msg == 0x0021) { message.Result = new IntPtr(3); return; }
            base.WndProc(ref message);
        }

        /// Puts `picture` on the screen with its top left at (left, top), in real pixels, at `opacity` of its own alpha.
        public void Present(Bitmap picture, int left, int top, byte opacity)
        {
            IntPtr screen = OverlayNative.GetDC(IntPtr.Zero);
            IntPtr memory = OverlayNative.CreateCompatibleDC(screen);
            IntPtr bitmap = IntPtr.Zero;
            IntPtr previous = IntPtr.Zero;
            try
            {
                bitmap = picture.GetHbitmap(Color.FromArgb(0));
                previous = OverlayNative.SelectObject(memory, bitmap);
                SIZE size = new SIZE { cx = picture.Width, cy = picture.Height };
                POINT source = new POINT { X = 0, Y = 0 };
                POINT at = new POINT { X = left, Y = top };
                BLENDFUNCTION blend = new BLENDFUNCTION { BlendOp = 0, BlendFlags = 0, SourceConstantAlpha = opacity, AlphaFormat = 1 };
                OverlayNative.UpdateLayeredWindow(Handle, screen, ref at, ref size, memory, ref source, 0, ref blend, 2);
            }
            finally
            {
                if (previous != IntPtr.Zero) OverlayNative.SelectObject(memory, previous);
                if (bitmap != IntPtr.Zero) OverlayNative.DeleteObject(bitmap);
                OverlayNative.DeleteDC(memory);
                OverlayNative.ReleaseDC(IntPtr.Zero, screen);
            }
        }

        /// Changes only how opaque the window is, keeping what it shows.
        public void Fade(byte opacity)
        {
            BLENDFUNCTION blend = new BLENDFUNCTION { BlendOp = 0, BlendFlags = 0, SourceConstantAlpha = opacity, AlphaFormat = 1 };
            OverlayNative.UpdateLayeredOpacity(Handle, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, ref blend, 2);
        }
    }

    static class Overlay
    {
        /// Called on the overlay's thread when the user stops the bot: how ("button" or "escape"), the grant it
        /// ended, and the session that grant belonged to.
        public static Action<string, string, string> Stopped;

        static Thread thread;
        static Control marshal;
        static readonly ManualResetEvent started = new ManualResetEvent(false);
        static readonly Stopwatch clock = Stopwatch.StartNew();
        static readonly object gate = new object();
        static System.Windows.Forms.Timer timer;

        // Whether a bot holds the screen (between Begin and End or Stop), and whether the overlay is up. A long quiet
        // spell takes the overlay down with the grant still held; the bot's next action brings it back.
        static volatile bool active;
        static bool visible;
        static bool fading;
        // While a capture that cannot leave the overlay out is taken, nothing of it is drawn.
        static bool capturing;
        static string name = "";
        static string status = "";
        static string grant = "";
        static string session = "";
        static Color tint = Color.FromArgb(255, 124, 172, 248);
        static double shownAt, lastUsed, lastFrame, lastPill;
        const double IDLE_HIDE_SECONDS = 40;

        // Coming and going. Each part is as present as its value, 0 to 1, as last drawn: the glow (and its breath), the
        // pill (and how far above its place it is, in unscaled pixels), the cursor (and how grown it is). Each coming or
        // going starts from where every part was when it began, so a fade called back rises again without a jump.
        static double enterAt = -10, leaveAt = -1;
        static double glowFrom, pillFrom, pointerFrom, dropFrom, growFrom;
        static double glowNow, pillNow, pointerNow, dropNow, growNow = 1;
        const double GLOW_IN = 0.62, PILL_DELAY = 0.1, PILL_IN = 0.52, POINTER_DELAY = 0.16, POINTER_IN = 0.46, LEAVE = 0.42;
        const double BREATH_SECONDS = 5.5, BREATH_DEPTH = 0.22;
        const double DROP = -18, LIFT = -10, GROW_FROM = 0.35, SHRINK_TO = 0.6;

        static readonly List<LayerWindow> glows = new List<LayerWindow>();
        static LayerWindow pill;
        static LayerWindow pillShadow;
        static LayerWindow pointer;
        static readonly HashSet<IntPtr> ourWindows = new HashSet<IntPtr>();
        static IntPtr pillHandle = IntPtr.Zero;
        static Rectangle pillBounds;
        static Rectangle stopBounds;
        static bool stopHover;
        static Font nameFont, doingFont, stopFont, keyFont, badgeFont;
        static Bitmap shadowPicture;
        static string shadowKey = "";
        static int shadowMargin;

        // The bot's cursor, in screen pixels, moved by springs: straight for a short hop, along an arc for a long one,
        // stretched a little along the way it travels.
        static Spring x, y, progress, axis, stretch;
        static bool arcing;
        static double fromX, fromY, controlX, controlY, toX, toY;
        static double restingSince = -1;
        static bool pressWhenThere;
        static double pressedAt = -10;
        // Set while the cursor rests; the helper waits on it so a click lands as the cursor arrives, not before.
        static readonly ManualResetEvent arrived = new ManualResetEvent(true);

        static IntPtr keyboardHook = IntPtr.Zero;
        static LowLevelKeyboardProc keyboardProc;

        // The grant the user last stopped, so an action already on its way under it is turned away.
        static string stoppedGrant = "";

        public static string StoppedGrant { get { lock (gate) return stoppedGrant; } }

        public static bool Active { get { return active; } }

        /// One of the overlay's own windows, which a click passes through (all but the pill).
        public static bool IsOurs(IntPtr window)
        {
            lock (gate) return ourWindows.Contains(window);
        }

        public static bool IsPill(IntPtr window)
        {
            lock (gate) return window != IntPtr.Zero && window == pillHandle;
        }

        /// Whether the overlay's windows are kept out of captures. When not (Windows before 10 2004), a capture
        /// hides them for its moment instead.
        public static bool ExcludedFromCapture()
        {
            if (!active) return true;
            bool excluded = true;
            Send(delegate
            {
                foreach (LayerWindow window in glows) excluded &= window.Excluded;
                if (pill != null) excluded &= pill.Excluded;
                if (pillShadow != null) excluded &= pillShadow.Excluded;
                if (pointer != null) excluded &= pointer.Excluded;
            });
            return excluded;
        }

        /// Hides the overlay for a capture where captures cannot leave it out, and brings it back after.
        public static void Hide(bool hidden)
        {
            Send(delegate
            {
                capturing = hidden;
                if (!visible) return;
                foreach (LayerWindow window in glows) window.Fade(hidden ? (byte)0 : ToByte(glowNow));
                if (pill != null) pill.Fade(hidden ? (byte)0 : ToByte(pillNow));
                if (pillShadow != null) pillShadow.Fade(hidden ? (byte)0 : ToByte(pillNow));
                if (pointer != null) pointer.Fade(hidden ? (byte)0 : ToByte(pointerNow));
            });
        }

        /* ---------------------------------------------------------------- */
        /* The thread it lives on                                            */
        /* ---------------------------------------------------------------- */

        static void Ensure()
        {
            lock (gate)
            {
                if (thread != null) return;
                thread = new Thread(Run);
                thread.IsBackground = true;
                thread.Name = "overlay";
                thread.SetApartmentState(ApartmentState.STA);
                thread.Start();
            }
            started.WaitOne(10000);
        }

        static void Run()
        {
            try
            {
                marshal = new Control();
                IntPtr unused = marshal.Handle;
                timer = new System.Windows.Forms.Timer();
                timer.Interval = 15;
                timer.Tick += delegate { Frame(); };
                started.Set();
                Application.Run();
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("overlay: " + error.Message);
                started.Set();
            }
        }

        static void Post(MethodInvoker action)
        {
            Ensure();
            if (marshal == null) return;
            try { marshal.BeginInvoke(action); } catch (Exception error) { Console.Error.WriteLine("overlay: " + error.Message); }
        }

        static void Send(MethodInvoker action)
        {
            Ensure();
            if (marshal == null) return;
            try { marshal.Invoke(action); } catch (Exception error) { Console.Error.WriteLine("overlay: " + error.Message); }
        }

        static double Now() { return clock.Elapsed.TotalSeconds; }

        /* ---------------------------------------------------------------- */
        /* What the screen helper asks of it                                 */
        /* ---------------------------------------------------------------- */

        /// Shows the overlay for a bot — or keeps it showing — under the grant the user gave it.
        public static void Begin(string who, string color, string grantId, string sessionId)
        {
            if (string.IsNullOrEmpty(who)) return;
            Send(delegate
            {
                lastUsed = Now();
                Color parsed = ParseColor(color, tint);
                string shortName = who.Length > 24 ? who.Substring(0, 23) + "\u2026" : who;
                bool changed = shortName != name || parsed != tint;
                name = shortName;
                tint = parsed;
                lock (gate)
                {
                    grant = grantId ?? "";
                    session = sessionId ?? "";
                }
                active = true;
                if (fading) Revive();
                if (!visible) ShowAll();
                else if (changed) { DrawGlows(); DrawPill(); }
            });
        }

        /// What the bot is doing now, for the pill: "is clicking", "is typing"… Empty says it is at the controls.
        public static void Say(string text)
        {
            if (!active) return;
            Post(delegate
            {
                if (!active) return;
                lastUsed = Now();
                if (fading) Revive();
                if (!visible) ShowAll();
                string next = text ?? "";
                if (next == status) return;
                status = next;
                DrawPill();
            });
        }

        /// The bot is about to act at a point on the desktop: the cursor travels there, and the pill says what it does.
        /// `press` shows it pressing once it arrives.
        public static void MoveTo(int screenX, int screenY, string doing, bool press)
        {
            if (!active) return;
            arrived.Reset();
            Post(delegate
            {
                if (!active) { arrived.Set(); return; }
                lastUsed = Now();
                if (fading) Revive();
                if (!visible) ShowAll();
                status = doing ?? "";
                pressWhenThere = press;
                double dx = screenX - x.Value;
                double dy = screenY - y.Value;
                double distance = Math.Sqrt(dx * dx + dy * dy);
                restingSince = -1;
                if (distance > 196)
                {
                    // A long hop travels along a shallow arc, as a hand would, rather than in a dead-straight line.
                    fromX = x.Value;
                    fromY = y.Value;
                    toX = screenX;
                    toY = screenY;
                    double angle = Math.Atan2(dy, dx) + Math.PI / 2.0 * (fromX > toX ? 1.0 : -1.0);
                    double lift = Math.Min(distance * 0.18, 60);
                    controlX = (fromX + toX) / 2.0 + Math.Cos(angle) * lift;
                    controlY = (fromY + toY) / 2.0 + Math.Sin(angle) * lift;
                    progress.Reset(0);
                    progress.Target = 1;
                    arcing = true;
                }
                else
                {
                    arcing = false;
                    x.Target = screenX;
                    y.Target = screenY;
                }
                if (distance > 1)
                {
                    // The stretch follows the direction of travel, turned the short way round.
                    double heading = Math.Atan2(dy, dx) * 180.0 / Math.PI;
                    double turn = ((heading - axis.Value) % 360 + 540) % 360 - 180;
                    axis.Target = axis.Value + turn;
                    stretch.Value = Math.Min(1.3, 1.0 + distance / 700.0);
                }
                else
                {
                    if (press) pressedAt = Now();
                    pressWhenThere = false;
                    arrived.Set();
                }
                DrawPill();
            });
        }

        /// Blocks until the cursor has arrived where the bot is acting, so the action lands as it gets there.
        public static void WaitArrived(int timeoutMs)
        {
            if (!active) return;
            arrived.WaitOne(timeoutMs);
        }

        /// The bot is no longer acting, but may again this turn: the cursor rests, and the overlay stays up a while.
        public static void Resting()
        {
            if (!active) return;
            Post(delegate { if (!active) return; lastUsed = Now(); if (status.Length > 0) { status = ""; if (visible) DrawPill(); } });
        }

        /// The grant ended — the bot finished, or it lapsed — so the overlay goes.
        public static void End()
        {
            Post(delegate { active = false; arrived.Set(); if (visible) FadeAway(); });
        }

        /// The user stopped the bot — its Stop, or Esc. Runs on the overlay's thread.
        static void Stop(string how)
        {
            if (!active) return;
            string endedGrant, endedSession;
            lock (gate)
            {
                stoppedGrant = grant;
                endedGrant = grant;
                endedSession = session;
            }
            active = false;
            arrived.Set();
            FadeAway();
            Action<string, string, string> stopped = Stopped;
            if (stopped != null) { try { stopped(how, endedGrant, endedSession); } catch { } }
        }

        /* ---------------------------------------------------------------- */
        /* Coming and going                                                  */
        /* ---------------------------------------------------------------- */

        static double Clamp01(double value) { return value < 0 ? 0 : value > 1 ? 1 : value; }
        static double EaseOutCubic(double t) { double u = 1 - t; return 1 - u * u * u; }
        static double EaseInCubic(double t) { return t * t * t; }
        static double EaseInOutCubic(double t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.Pow(-2 * t + 2, 3) / 2; }

        /// Passes its mark by a little and settles back, as a thing set down does.
        static double EaseOutBack(double t, double overshoot)
        {
            double u = t - 1;
            return 1 + (overshoot + 1) * u * u * u + overshoot * u * u;
        }

        static byte ToByte(double level) { return (byte)Math.Max(0, Math.Min(255, Math.Round(level * 255))); }

        /// Where every part is at `now`: coming in, breathing, or going. False once going has finished.
        static bool Animate(double now)
        {
            if (leaveAt >= 0)
            {
                double t = Clamp01((now - leaveAt) / LEAVE);
                double quick = Clamp01((now - leaveAt) / (LEAVE * 0.7));
                glowNow = glowFrom * (1 - EaseInOutCubic(t));
                pillNow = pillFrom * (1 - EaseInCubic(quick));
                dropNow = dropFrom + (LIFT - dropFrom) * EaseInCubic(quick);
                pointerNow = pointerFrom * (1 - EaseInCubic(t));
                growNow = growFrom + (SHRINK_TO - growFrom) * EaseInCubic(t);
                return t < 1;
            }
            double since = now - enterAt;
            double glowIn = EaseOutCubic(Clamp01(since / GLOW_IN));
            // Once in, the glow breathes: from full down by a fifth and back, slowly.
            double breath = since <= GLOW_IN ? 1 : 1 - BREATH_DEPTH * (0.5 - 0.5 * Math.Cos((since - GLOW_IN) * 2.0 * Math.PI / BREATH_SECONDS));
            glowNow = (glowFrom + (1 - glowFrom) * glowIn) * breath;
            double pillIn = Clamp01((since - PILL_DELAY) / PILL_IN);
            pillNow = pillFrom + (1 - pillFrom) * EaseOutCubic(Clamp01(pillIn * 1.4));
            dropNow = dropFrom * (1 - EaseOutBack(pillIn, 1.7));
            double pointerIn = Clamp01((since - POINTER_DELAY) / POINTER_IN);
            pointerNow = pointerFrom + (1 - pointerFrom) * EaseOutCubic(Clamp01(pointerIn * 1.5));
            growNow = growFrom + (1 - growFrom) * EaseOutBack(pointerIn, 1.9);
            return true;
        }

        /// Still coming in or going: the pill moves, so it is drawn every frame rather than only for its shimmer.
        static bool Moving(double now)
        {
            return leaveAt >= 0 || now - enterAt < Math.Max(PILL_DELAY + PILL_IN, POINTER_DELAY + POINTER_IN) + 0.05;
        }

        /// Everything starts from nothing: the glow dark, the pill above its place, the cursor small at the pointer.
        static void StartEntrance(double now)
        {
            enterAt = now;
            leaveAt = -1;
            glowFrom = 0;
            pillFrom = 0;
            pointerFrom = 0;
            dropFrom = DROP;
            growFrom = GROW_FROM;
            Animate(now);
        }

        /// A fade already under way, called back because the bot is at the controls again: it rises from where it is.
        static void Revive()
        {
            double now = Now();
            Animate(now);
            fading = false;
            leaveAt = -1;
            enterAt = now;
            glowFrom = glowNow;
            pillFrom = pillNow;
            pointerFrom = pointerNow;
            dropFrom = dropNow;
            growFrom = growNow;
        }

        static void FadeAway()
        {
            if (!visible || fading) return;
            double now = Now();
            Animate(now);
            fading = true;
            leaveAt = now;
            glowFrom = glowNow;
            pillFrom = pillNow;
            pointerFrom = pointerNow;
            dropFrom = dropNow;
            growFrom = growNow;
        }

        static void FinishFade()
        {
            fading = false;
            leaveAt = -1;
            visible = false;
            timer.Stop();
            RemoveHook();
            CloseWindows();
            status = "";
            arrived.Set();
        }

        /* ---------------------------------------------------------------- */
        /* The windows                                                       */
        /* ---------------------------------------------------------------- */

        static void ShowAll()
        {
            visible = true;
            fading = false;
            shownAt = Now();
            lastUsed = shownAt;
            lastFrame = shownAt;
            StartEntrance(shownAt);
            // The bot's cursor starts where the user's pointer is, and leaves from there.
            POINT at;
            double startX, startY;
            if (Program.CursorPoint(out at)) { startX = at.X; startY = at.Y; }
            else
            {
                Rectangle primary = Screen.PrimaryScreen.Bounds;
                startX = primary.Left + primary.Width / 2.0;
                startY = primary.Top + primary.Height / 2.0;
            }
            x = new Spring(startX, 0.9, 0.19);
            y = new Spring(startY, 0.9, 0.19);
            progress = new Spring(1, 0.88, 0.18);
            axis = new Spring(0, 0.82, 0.08);
            stretch = new Spring(1, 0.86, 0.12);
            arcing = false;
            restingSince = Now();
            pressWhenThere = false;

            BuildWindows();
            DrawGlows();
            DrawPill();
            DrawPointer();
            foreach (LayerWindow window in glows) Reveal(window);
            // The shadow first, so the pill is shown above it.
            Reveal(pillShadow);
            Reveal(pill);
            Reveal(pointer);
            InstallHook();
            timer.Start();
        }

        static void Reveal(LayerWindow window)
        {
            if (window == null) return;
            try { window.Show(); } catch (Exception error) { Console.Error.WriteLine("overlay: " + error.Message); }
        }

        static void BuildWindows()
        {
            CloseWindows();
            foreach (Monitor monitor in Program.AllMonitors())
            {
                LayerWindow window = new LayerWindow(true);
                // One pixel short of the monitor, so Windows never takes it for an app gone full screen.
                window.Bounds = new Rectangle(monitor.Bounds.Left, monitor.Bounds.Top, monitor.Bounds.Right - monitor.Bounds.Left, monitor.Bounds.Bottom - monitor.Bounds.Top - 1);
                IntPtr handle = window.Handle;
                lock (gate) ourWindows.Add(handle);
                glows.Add(window);
            }

            pillShadow = new LayerWindow(true);
            IntPtr shadowWindow = pillShadow.Handle;
            lock (gate) ourWindows.Add(shadowWindow);

            pill = new LayerWindow(false);
            IntPtr pillWindow = pill.Handle;
            lock (gate) { ourWindows.Add(pillWindow); pillHandle = pillWindow; }
            pill.MouseDown += delegate(object sender, MouseEventArgs e) { if (e.Button == MouseButtons.Left && OverStop(e)) Stop("button"); };
            pill.MouseMove += delegate(object sender, MouseEventArgs e)
            {
                bool over = OverStop(e);
                pill.Cursor = over ? Cursors.Hand : Cursors.Default;
                if (over != stopHover) { stopHover = over; DrawPill(); }
            };
            pill.MouseLeave += delegate { if (stopHover) { stopHover = false; DrawPill(); } };

            pointer = new LayerWindow(true);
            IntPtr pointerWindow = pointer.Handle;
            lock (gate) ourWindows.Add(pointerWindow);
        }

        static bool OverStop(MouseEventArgs e)
        {
            Rectangle padded = Rectangle.Inflate(stopBounds, 6, 6);
            return padded.Contains(pillBounds.Left + e.X, pillBounds.Top + e.Y);
        }

        static void CloseWindows()
        {
            foreach (LayerWindow window in glows) { try { window.Close(); window.Dispose(); } catch { } }
            glows.Clear();
            if (pill != null) { try { pill.Close(); pill.Dispose(); } catch { } pill = null; }
            if (pillShadow != null) { try { pillShadow.Close(); pillShadow.Dispose(); } catch { } pillShadow = null; }
            if (pointer != null) { try { pointer.Close(); pointer.Dispose(); } catch { } pointer = null; }
            lock (gate) { ourWindows.Clear(); pillHandle = IntPtr.Zero; }
            stopHover = false;
        }

        /* ---------------------------------------------------------------- */
        /* Drawing                                                           */
        /* ---------------------------------------------------------------- */

        static double ScaleOf(Monitor monitor)
        {
            return monitor == null || monitor.Dpi == 0 ? 1.0 : monitor.Dpi / 96.0;
        }

        static Monitor MonitorAt(double px, double py)
        {
            List<Monitor> monitors = Program.AllMonitors();
            foreach (Monitor monitor in monitors)
                if (px >= monitor.Bounds.Left && px < monitor.Bounds.Right && py >= monitor.Bounds.Top && py < monitor.Bounds.Bottom) return monitor;
            return monitors.Count > 0 ? monitors[0] : null;
        }

        /// Each monitor's glow, drawn once at full strength: it comes, breathes and goes through its window's opacity.
        static void DrawGlows()
        {
            List<Monitor> monitors = Program.AllMonitors();
            for (int index = 0; index < glows.Count; index++)
            {
                LayerWindow window = glows[index];
                double scale = index < monitors.Count ? ScaleOf(monitors[index]) : 1.0;
                Rectangle bounds = window.Bounds;
                using (Bitmap bitmap = GlowPicture(bounds.Width, bounds.Height, scale)) window.Present(bitmap, bounds.Left, bounds.Top, capturing ? (byte)0 : ToByte(glowNow));
            }
        }

        static Bitmap GlowPicture(int width, int height, double scale)
        {
            Bitmap bitmap = new Bitmap(Math.Max(1, width), Math.Max(1, height), PixelFormat.Format32bppArgb);
            using (Graphics graphics = Graphics.FromImage(bitmap))
            {
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                int depth = (int)Math.Round(40 * scale);
                DrawEdge(graphics, new Rectangle(0, 0, width, depth), 90f);
                DrawEdge(graphics, new Rectangle(0, height - depth, width, depth), 270f);
                DrawEdge(graphics, new Rectangle(0, 0, depth, height), 0f);
                DrawEdge(graphics, new Rectangle(width - depth, 0, depth, height), 180f);
                int inset = (int)Math.Round(4 * scale);
                int radius = (int)Math.Round(14 * scale);
                using (GraphicsPath frame = RoundedRect(new Rectangle(inset, inset, width - inset * 2 - 1, height - inset * 2 - 1), radius))
                {
                    using (Pen bloom = new Pen(Color.FromArgb(70, Lighten(tint)), (float)(6 * scale))) graphics.DrawPath(bloom, frame);
                    using (Pen line = new Pen(Color.FromArgb(225, Lighten(tint)), (float)(2 * scale))) graphics.DrawPath(line, frame);
                }
            }
            return bitmap;
        }

        static void DrawEdge(Graphics graphics, Rectangle area, float angle)
        {
            if (area.Width <= 0 || area.Height <= 0) return;
            // The brush's own rectangle is one larger than the area, so GDI+ never wraps a sliver of the far colour in.
            Rectangle span = Rectangle.Inflate(area, 1, 1);
            using (LinearGradientBrush brush = new LinearGradientBrush(span, Color.Black, Color.Black, angle))
            {
                ColorBlend blend = new ColorBlend(4);
                blend.Colors = new Color[] { Color.FromArgb(190, tint), Color.FromArgb(130, Lighten(tint)), Color.FromArgb(46, tint), Color.FromArgb(0, tint) };
                blend.Positions = new float[] { 0f, 0.25f, 0.65f, 1f };
                brush.InterpolationColors = blend;
                graphics.FillRectangle(brush, area);
            }
        }

        static double fontScale = -1;

        static void EnsureFonts(double scale)
        {
            if (Math.Abs(scale - fontScale) < 0.01 && nameFont != null) return;
            if (nameFont != null) { nameFont.Dispose(); doingFont.Dispose(); stopFont.Dispose(); keyFont.Dispose(); badgeFont.Dispose(); }
            nameFont = new Font("Segoe UI Semibold", (float)(14 * scale), FontStyle.Regular, GraphicsUnit.Pixel);
            doingFont = new Font("Segoe UI", (float)(14 * scale), FontStyle.Regular, GraphicsUnit.Pixel);
            stopFont = new Font("Segoe UI Semibold", (float)(13 * scale), FontStyle.Regular, GraphicsUnit.Pixel);
            keyFont = new Font("Segoe UI Semibold", (float)(10.5 * scale), FontStyle.Regular, GraphicsUnit.Pixel);
            badgeFont = new Font("Segoe UI", (float)(14 * scale), FontStyle.Bold, GraphicsUnit.Pixel);
            fontScale = scale;
        }

        static StringFormat Typographic()
        {
            StringFormat format = new StringFormat(StringFormat.GenericTypographic);
            format.FormatFlags |= StringFormatFlags.MeasureTrailingSpaces | StringFormatFlags.NoWrap;
            return format;
        }

        /// The pill, on the monitor the bot's cursor is on, drawn into the screen — and its shadow under it.
        static void DrawPill()
        {
            if (pill == null || x == null) return;
            Monitor monitor = MonitorAt(x.Value, y.Value);
            if (monitor == null) return;
            int left, top;
            double scale;
            using (Bitmap picture = PillPicture(monitor, out left, out top, out scale))
            {
                pillBounds = new Rectangle(left, top, picture.Width, picture.Height);
                byte opacity = capturing ? (byte)0 : ToByte(pillNow);
                if (pillShadow != null)
                {
                    Bitmap shadow = ShadowPicture(picture.Width, picture.Height, scale);
                    pillShadow.Present(shadow, left - shadowMargin, top - shadowMargin, opacity);
                }
                pill.Present(picture, left, top, opacity);
            }
        }

        /// The pill's picture, and where its top left goes on `monitor`: the bot's badge with its ring, who is at the
        /// controls and what it is doing, then Stop with its Esc key.
        static Bitmap PillPicture(Monitor monitor, out int left, out int top, out double scale)
        {
            double s = ScaleOf(monitor);
            scale = s;
            EnsureFonts(s);
            Func<double, int> px = delegate(double value) { return (int)Math.Round(value * s); };
            bool acting = !string.IsNullOrEmpty(status);
            string doing = acting ? status : "is using your computer";
            double now = Now();

            using (StringFormat typographic = Typographic())
            using (Bitmap sizing = new Bitmap(1, 1))
            using (Graphics measurer = Graphics.FromImage(sizing))
            {
                measurer.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                SizeF nameSize = measurer.MeasureString(name, nameFont, PointF.Empty, typographic);
                SizeF doingSize = measurer.MeasureString(doing, doingFont, PointF.Empty, typographic);
                SizeF stopSize = measurer.MeasureString("Stop", stopFont, PointF.Empty, typographic);
                SizeF keySize = measurer.MeasureString("Esc", keyFont, PointF.Empty, typographic);

                int height = px(44);
                int badge = px(28);
                int badgeLeft = px(8);
                int textLeft = badgeLeft + badge + px(11);
                int nameWidth = (int)Math.Ceiling(nameSize.Width);
                int gap = px(4.5);
                int doingWidth = Math.Max(px(40), Math.Min((int)Math.Ceiling(doingSize.Width), px(400) - nameWidth));
                int keyWidth = (int)Math.Ceiling(keySize.Width) + px(11);
                int keyHeight = px(18);
                int stopHeight = px(30);
                int square = px(9);
                int stopWidth = px(11) + square + px(7) + (int)Math.Ceiling(stopSize.Width) + px(9) + keyWidth + px(6);
                int width = textLeft + nameWidth + gap + doingWidth + px(18) + stopWidth + px(7);
                int monitorWidth = monitor.Bounds.Right - monitor.Bounds.Left;
                left = monitor.Bounds.Left + (monitorWidth - width) / 2;
                top = monitor.Bounds.Top + px(18) + (int)Math.Round(dropNow * s);

                Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
                using (Graphics graphics = Graphics.FromImage(bitmap))
                {
                    graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    graphics.CompositingQuality = CompositingQuality.HighQuality;
                    graphics.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                    Rectangle whole = new Rectangle(0, 0, width, height);
                    using (GraphicsPath body = RoundedRect(new Rectangle(0, 0, width - 1, height - 1), height / 2))
                    {
                        // Dark glass: a little lighter at the top than at the bottom.
                        using (LinearGradientBrush fill = new LinearGradientBrush(whole, Color.FromArgb(246, 46, 48, 57), Color.FromArgb(246, 25, 26, 32), 90f))
                            graphics.FillPath(fill, body);
                        // The bot's colour glowing out from behind its badge.
                        graphics.SetClip(body);
                        int haloSize = px(104);
                        int haloX = badgeLeft + badge / 2 - haloSize / 2;
                        int haloY = height / 2 - haloSize / 2;
                        using (GraphicsPath haloPath = new GraphicsPath())
                        {
                            haloPath.AddEllipse(haloX, haloY, haloSize, haloSize);
                            using (PathGradientBrush halo = new PathGradientBrush(haloPath))
                            {
                                halo.CenterColor = Color.FromArgb(58, tint);
                                halo.SurroundColors = new Color[] { Color.FromArgb(0, tint) };
                                graphics.FillPath(halo, haloPath);
                            }
                        }
                        graphics.ResetClip();
                        // Light caught along the top edge, as on glass, gone by half way down.
                        using (GraphicsPath rim = RoundedRect(new Rectangle(1, 1, width - 3, height - 3), (height - 2) / 2))
                        using (LinearGradientBrush rimBrush = new LinearGradientBrush(whole, Color.FromArgb(58, 255, 255, 255), Color.FromArgb(0, 255, 255, 255), 90f))
                        {
                            Blend fallOff = new Blend(3);
                            fallOff.Factors = new float[] { 0f, 1f, 1f };
                            fallOff.Positions = new float[] { 0f, 0.5f, 1f };
                            rimBrush.Blend = fallOff;
                            using (Pen rimPen = new Pen(rimBrush, 1f)) graphics.DrawPath(rimPen, rim);
                        }
                        using (Pen edge = new Pen(Color.FromArgb(34, 255, 255, 255), 1f)) graphics.DrawPath(edge, body);
                    }

                    // The bot's badge: its colour, its initial.
                    int badgeTop = (height - badge) / 2;
                    Rectangle badgeArea = new Rectangle(badgeLeft, badgeTop, badge, badge);
                    using (LinearGradientBrush badgeFill = new LinearGradientBrush(badgeArea, Lighten(tint), tint, 45f))
                        graphics.FillEllipse(badgeFill, badgeArea);
                    using (Pen badgeEdge = new Pen(Color.FromArgb(60, 255, 255, 255), 1f))
                        graphics.DrawEllipse(badgeEdge, badgeArea);
                    string initial = name.Length > 0 ? name.Substring(0, char.IsSurrogate(name[0]) && name.Length > 1 ? 2 : 1).ToUpperInvariant() : "";
                    using (StringFormat centred = Typographic())
                    using (SolidBrush ink = new SolidBrush(Luminance(tint) > 0.62 ? Color.FromArgb(255, 26, 22, 14) : Color.FromArgb(255, 255, 255, 255)))
                    {
                        centred.Alignment = StringAlignment.Center;
                        centred.LineAlignment = StringAlignment.Center;
                        graphics.DrawString(initial, badgeFont, ink, new RectangleF(badgeArea.Left, badgeArea.Top + px(0.5f), badgeArea.Width, badgeArea.Height), centred);
                    }

                    // Around the badge: a turning arc while the bot acts, a slow pulse while it only holds the screen.
                    float ringOut = (float)(3 * s);
                    RectangleF ring = new RectangleF(badgeArea.Left - ringOut, badgeArea.Top - ringOut, badgeArea.Width + ringOut * 2, badgeArea.Height + ringOut * 2);
                    if (acting)
                    {
                        using (Pen track = new Pen(Color.FromArgb(46, Lighten(tint)), (float)(1.6 * s))) graphics.DrawEllipse(track, ring);
                        float start = (float)(((now - shownAt) * 340.0) % 360.0);
                        using (Pen arc = new Pen(Color.FromArgb(240, Lighten(tint)), (float)(1.9 * s)))
                        {
                            arc.StartCap = LineCap.Round;
                            arc.EndCap = LineCap.Round;
                            graphics.DrawArc(arc, ring, start, 108f);
                        }
                    }
                    else
                    {
                        double pulse = 0.5 + 0.5 * Math.Sin((now - shownAt) * 2.0 * Math.PI / 2.4);
                        using (Pen soft = new Pen(Color.FromArgb((int)(36 + 84 * pulse), Lighten(tint)), (float)(1.6 * s))) graphics.DrawEllipse(soft, ring);
                    }

                    // Who, then what it is doing: the name bright, the doing quieter, with a lighter band sweeping across
                    // it while the bot acts.
                    float textTop = (height - nameSize.Height) / 2f;
                    using (StringFormat typo = Typographic())
                    {
                        using (SolidBrush bright = new SolidBrush(Color.FromArgb(252, 255, 255, 255)))
                            graphics.DrawString(name, nameFont, bright, textLeft, textTop, typo);
                        RectangleF doingArea = new RectangleF(textLeft + nameWidth + gap, textTop, doingWidth, nameSize.Height + px(2));
                        typo.Trimming = StringTrimming.EllipsisCharacter;
                        if (acting)
                        {
                            double sweep = -0.25 + 1.5 * ((now % 2.4) / 2.4);
                            float first = (float)Math.Max(0.001, Math.Min(0.996, sweep - 0.2));
                            float middle = (float)Math.Max(first + 0.001, Math.Min(0.997, sweep));
                            float last = (float)Math.Max(middle + 0.001, Math.Min(0.998, sweep + 0.2));
                            using (LinearGradientBrush shimmer = new LinearGradientBrush(new RectangleF(doingArea.X - 1, doingArea.Y, doingArea.Width + 2, doingArea.Height), Color.White, Color.White, 0f))
                            {
                                Color quiet = Color.FromArgb(200, 214, 218, 228);
                                ColorBlend blend = new ColorBlend(5);
                                blend.Colors = new Color[] { quiet, quiet, Color.FromArgb(255, 255, 255, 255), quiet, quiet };
                                blend.Positions = new float[] { 0f, first, middle, last, 1f };
                                shimmer.InterpolationColors = blend;
                                graphics.DrawString(doing, doingFont, shimmer, doingArea, typo);
                            }
                        }
                        else
                        {
                            using (SolidBrush quiet = new SolidBrush(Color.FromArgb(190, 214, 218, 228)))
                                graphics.DrawString(doing, doingFont, quiet, doingArea, typo);
                        }
                    }

                    // Stop: a red-toned capsule with its square, its word and its key.
                    int stopLeft = width - px(7) - stopWidth;
                    Rectangle stop = new Rectangle(stopLeft, (height - stopHeight) / 2, stopWidth, stopHeight);
                    stopBounds = new Rectangle(left + stop.Left, top + stop.Top, stop.Width, stop.Height);
                    using (GraphicsPath stopPath = RoundedRect(stop, stopHeight / 2))
                    {
                        using (SolidBrush stopFill = new SolidBrush(stopHover ? Color.FromArgb(96, 255, 86, 74) : Color.FromArgb(54, 255, 86, 74)))
                            graphics.FillPath(stopFill, stopPath);
                        using (Pen stopEdge = new Pen(stopHover ? Color.FromArgb(150, 255, 138, 126) : Color.FromArgb(84, 255, 138, 126), 1f))
                            graphics.DrawPath(stopEdge, stopPath);
                    }
                    int inside = stop.Left + px(11);
                    using (GraphicsPath squarePath = RoundedRect(new Rectangle(inside, (height - square) / 2, square, square), Math.Max(1, px(2.5))))
                    using (SolidBrush red = new SolidBrush(Color.FromArgb(255, 255, 112, 98)))
                        graphics.FillPath(red, squarePath);
                    inside += square + px(7);
                    using (StringFormat typo = Typographic())
                    using (SolidBrush stopInk = new SolidBrush(Color.FromArgb(255, 255, 226, 222)))
                        graphics.DrawString("Stop", stopFont, stopInk, inside, (height - stopSize.Height) / 2f, typo);
                    inside += (int)Math.Ceiling(stopSize.Width) + px(9);
                    Rectangle key = new Rectangle(inside, (height - keyHeight) / 2, keyWidth, keyHeight);
                    using (GraphicsPath keyPath = RoundedRect(key, px(5)))
                    {
                        using (SolidBrush keyFill = new SolidBrush(Color.FromArgb(30, 255, 255, 255))) graphics.FillPath(keyFill, keyPath);
                        using (Pen keyEdge = new Pen(Color.FromArgb(76, 255, 255, 255), 1f)) graphics.DrawPath(keyEdge, keyPath);
                    }
                    // A keycap's lower lip.
                    using (Pen lip = new Pen(Color.FromArgb(40, 0, 0, 0), 1f))
                        graphics.DrawLine(lip, key.Left + px(4), key.Bottom - 1, key.Right - px(4), key.Bottom - 1);
                    using (StringFormat centred = Typographic())
                    using (SolidBrush keyInk = new SolidBrush(Color.FromArgb(236, 238, 240, 246)))
                    {
                        centred.Alignment = StringAlignment.Center;
                        centred.LineAlignment = StringAlignment.Center;
                        graphics.DrawString("Esc", keyFont, keyInk, new RectangleF(key.Left, key.Top, key.Width, key.Height), centred);
                    }
                }
                return bitmap;
            }
        }

        /// The pill's soft shadow, as a picture `shadowMargin` larger than the pill all round, kept while its size holds.
        static Bitmap ShadowPicture(int width, int height, double scale)
        {
            string key = width + "x" + height + "@" + scale.ToString("0.00");
            if (shadowPicture != null && key == shadowKey) return shadowPicture;
            if (shadowPicture != null) shadowPicture.Dispose();
            int margin = (int)Math.Round(18 * scale);
            int offset = (int)Math.Round(4 * scale);
            Bitmap bitmap = new Bitmap(width + margin * 2, height + margin * 2, PixelFormat.Format32bppArgb);
            using (Graphics graphics = Graphics.FromImage(bitmap))
            {
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                // Layers of faint dark, wider and fainter outward: together, a shadow that softens as it spreads.
                for (int i = margin; i >= 1; i--)
                {
                    double near = 1.0 - (double)i / margin;
                    int alpha = (int)Math.Round(255 * 0.05 * near * near);
                    if (alpha <= 0) continue;
                    Rectangle layer = new Rectangle(margin - i, margin - i + offset, width + i * 2, height + i * 2);
                    using (GraphicsPath path = RoundedRect(layer, height / 2 + i))
                    using (SolidBrush shade = new SolidBrush(Color.FromArgb(alpha, 0, 0, 0)))
                        graphics.FillPath(shade, path);
                }
            }
            shadowPicture = bitmap;
            shadowKey = key;
            shadowMargin = margin;
            return bitmap;
        }

        /// The bot's cursor at its spring-driven point: stretched along its travel, breathing while it rests, dipping
        /// as it presses, with a ring spreading from where it pressed — and grown, or shrunk, as it comes and goes.
        static void DrawPointer() { DrawPointer(null); }

        static void DrawPointer(string saveTo)
        {
            if ((pointer == null && saveTo == null) || x == null) return;
            double scale = ScaleOf(MonitorAt(x.Value, y.Value));
            int size = (int)Math.Round(72 * scale);
            float half = size / 2f;
            double now = Now();
            using (Bitmap bitmap = new Bitmap(size, size, PixelFormat.Format32bppArgb))
            {
                using (Graphics graphics = Graphics.FromImage(bitmap))
                {
                    graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    double pressed = now - pressedAt;
                    if (pressed >= 0 && pressed < 0.5)
                    {
                        double t = pressed / 0.5;
                        float ring = (float)((6 + 24 * (1 - (1 - t) * (1 - t))) * scale);
                        using (Pen pen = new Pen(Color.FromArgb((int)(180 * (1 - t)), Lighten(tint)), (float)(2.4 * scale)))
                            graphics.DrawEllipse(pen, half - ring, half - ring, ring * 2, ring * 2);
                    }

                    double breathe = 1.0, tilt = 0;
                    if (restingSince >= 0)
                    {
                        double rest = now - restingSince;
                        breathe = 1.0 + Math.Sin(rest * 3.2) * 0.04;
                        tilt = Math.Sin(rest * 2.5) * 3.0;
                    }
                    double dip = pressed >= 0 && pressed < 0.18 ? 1.0 - 0.16 * Math.Sin(pressed / 0.18 * Math.PI) : 1.0;
                    double along = Math.Max(0.6, stretch.Value);
                    float heading = (float)axis.Value;
                    graphics.TranslateTransform(half, half);
                    graphics.ScaleTransform((float)growNow, (float)growNow);
                    graphics.RotateTransform(heading);
                    graphics.ScaleTransform((float)(along * breathe * dip), (float)(breathe * dip / Math.Sqrt(along)));
                    graphics.RotateTransform(-heading);
                    graphics.RotateTransform((float)tilt);
                    graphics.ScaleTransform((float)scale, (float)scale);
                    PaintArrow(graphics);
                }
                int left = (int)Math.Round(x.Value - half);
                int top = (int)Math.Round(y.Value - half);
                if (saveTo != null) bitmap.Save(saveTo, ImageFormat.Png);
                else pointer.Present(bitmap, left, top, capturing ? (byte)0 : ToByte(pointerNow));
            }
        }

        /// A cursor arrow of the overlay's own, its point at the origin, filled with the bot's tint and edged in white.
        static void PaintArrow(Graphics graphics)
        {
            PointF[] outline = new PointF[]
            {
                new PointF(0f, 0f), new PointF(0f, 19.5f), new PointF(4.9f, 15.2f), new PointF(8.3f, 22.6f),
                new PointF(11.4f, 21.2f), new PointF(8.0f, 13.9f), new PointF(14.6f, 13.6f),
            };
            using (GraphicsPath path = new GraphicsPath())
            {
                path.AddPolygon(outline);
                using (Pen glow = new Pen(Color.FromArgb(70, tint), 7f)) { glow.LineJoin = LineJoin.Round; graphics.DrawPath(glow, path); }
                using (Pen shade = new Pen(Color.FromArgb(90, 0, 0, 0), 3.2f)) { shade.LineJoin = LineJoin.Round; graphics.DrawPath(shade, path); }
                using (LinearGradientBrush fill = new LinearGradientBrush(new PointF(0f, 0f), new PointF(10f, 22f), Lighten(tint), tint))
                    graphics.FillPath(fill, path);
                using (Pen edge = new Pen(Color.White, 1.6f)) { edge.LineJoin = LineJoin.Round; graphics.DrawPath(edge, path); }
            }
        }

        /* ---------------------------------------------------------------- */
        /* The animation loop                                                */
        /* ---------------------------------------------------------------- */

        static void Frame()
        {
            if (!visible) return;
            double now = Now();
            double dt = now - lastFrame;
            if (dt <= 0) dt = 0.015;
            if (dt > 0.1) dt = 0.1;
            lastFrame = now;

            if (!Animate(now)) { FinishFade(); return; }

            if (!fading)
            {
                bool moving;
                if (arcing)
                {
                    bool going = progress.Step(dt);
                    double u = Math.Max(0, Math.Min(1, progress.Value));
                    double v = 1 - u;
                    x.Reset(v * v * fromX + 2 * v * u * controlX + u * u * toX);
                    y.Reset(v * v * fromY + 2 * v * u * controlY + u * u * toY);
                    if (!going || u >= 0.995)
                    {
                        arcing = false;
                        x.Reset(toX);
                        y.Reset(toY);
                    }
                    moving = arcing;
                }
                else
                {
                    bool movingX = x.Step(dt);
                    bool movingY = y.Step(dt);
                    moving = movingX || movingY;
                }
                axis.Step(dt);
                stretch.Step(dt);
                if (!moving && restingSince < 0)
                {
                    restingSince = now;
                    if (pressWhenThere) { pressedAt = now; pressWhenThere = false; }
                    arrived.Set();
                }
            }

            if (capturing) return;
            byte glow = ToByte(glowNow);
            foreach (LayerWindow window in glows) window.Fade(glow);
            DrawPointer();
            if (Moving(now) || now - lastPill >= 0.033) { lastPill = now; DrawPill(); }

            if (!fading && now - lastUsed > IDLE_HIDE_SECONDS) FadeAway();
        }

        /* ---------------------------------------------------------------- */
        /* Esc, while the overlay shows                                      */
        /* ---------------------------------------------------------------- */

        static void InstallHook()
        {
            if (keyboardHook != IntPtr.Zero) return;
            keyboardProc = KeyboardHook;
            keyboardHook = OverlayNative.SetWindowsHookEx(13, keyboardProc, OverlayNative.GetModuleHandle(null), 0);
        }

        static void RemoveHook()
        {
            if (keyboardHook == IntPtr.Zero) return;
            try { OverlayNative.UnhookWindowsHookEx(keyboardHook); } catch { }
            keyboardHook = IntPtr.Zero;
            keyboardProc = null;
        }

        static IntPtr KeyboardHook(int code, IntPtr wParam, IntPtr lParam)
        {
            try
            {
                if (code >= 0 && active && visible && !fading)
                {
                    int message = wParam.ToInt32();
                    if (message == 0x0100 || message == 0x0104)
                    {
                        KBDLLHOOKSTRUCT info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                        // LLKHF_INJECTED and LLKHF_LOWER_IL_INJECTED: a key a program put in, the bot's own among them.
                        bool injected = (info.flags & 0x12) != 0;
                        if (info.vkCode == 0x1B && !injected)
                        {
                            // Handed on rather than done here: Windows drops a low-level hook that keeps it waiting.
                            marshal.BeginInvoke((MethodInvoker)delegate { Stop("escape"); });
                            // The user's Esc stopped the bot; it does not also reach the app in front.
                            return new IntPtr(1);
                        }
                    }
                }
            }
            catch { }
            return OverlayNative.CallNextHookEx(keyboardHook, code, wParam, lParam);
        }

        /* ---------------------------------------------------------------- */
        /* Samples                                                           */
        /* ---------------------------------------------------------------- */

        /// Draws the overlay's parts into PNGs in `dir` without showing anything — captures leave the real overlay out,
        /// so this is how its look is checked: the pill at rest, at work and with Stop under the pointer, each on a
        /// light and a dark desktop with the glow's top edge behind it; how it comes in and goes, a frame at a time;
        /// the cursor resting, travelling, pressing and ringing; and a glow.
        public static void RenderSamples(string dir, string who, string color)
        {
            System.IO.Directory.CreateDirectory(dir);
            name = string.IsNullOrEmpty(who) ? "Pip" : who;
            tint = ParseColor(color, tint);
            shownAt = Now() - 0.45;
            Rectangle primary = Screen.PrimaryScreen.Bounds;
            x = new Spring(primary.Left + primary.Width / 2.0, 0.9, 0.19);
            y = new Spring(primary.Top + primary.Height / 2.0, 0.9, 0.19);
            axis = new Spring(0, 0.82, 0.08);
            stretch = new Spring(1, 0.86, 0.12);
            progress = new Spring(1, 0.88, 0.18);
            restingSince = Now();
            Monitor monitor = MonitorAt(x.Value, y.Value);
            glowNow = 1;
            pillNow = 1;
            pointerNow = 1;
            dropNow = 0;
            growNow = 1;

            status = "";
            SavePillOnDesktop(dir, "pill-idle.png", monitor);
            status = "is clicking";
            SavePillOnDesktop(dir, "pill-clicking.png", monitor);
            stopHover = true;
            SavePillOnDesktop(dir, "pill-clicking-hover.png", monitor);
            stopHover = false;
            status = "is typing in Notepad";
            SaveFilm(dir, "pill-entrance.png", monitor, false);
            SaveFilm(dir, "pill-leaving.png", monitor, true);

            SaveCursorSample(dir, "cursor-rest.png");
            axis.Value = 35;
            stretch.Value = 1.25;
            restingSince = -1;
            SaveCursorSample(dir, "cursor-travelling.png");
            stretch.Value = 1;
            pressedAt = Now() - 0.09;
            SaveCursorSample(dir, "cursor-pressing.png");
            pressedAt = Now() - 0.25;
            SaveCursorSample(dir, "cursor-ring.png");
            using (Bitmap glow = GlowPicture(900, 520, 1.0)) glow.Save(System.IO.Path.Combine(dir, "glow.png"), ImageFormat.Png);
        }

        /// The top of a screen — a light desktop on the left half, a dark one on the right — with the glow along it.
        static Bitmap DesktopTop(int width, int height, double scale)
        {
            Bitmap desktop = new Bitmap(width, height, PixelFormat.Format32bppArgb);
            using (Graphics graphics = Graphics.FromImage(desktop))
            {
                using (SolidBrush paper = new SolidBrush(Color.FromArgb(255, 238, 240, 244))) graphics.FillRectangle(paper, 0, 0, width / 2, height);
                using (SolidBrush night = new SolidBrush(Color.FromArgb(255, 30, 32, 38))) graphics.FillRectangle(night, width / 2, 0, width - width / 2, height);
            }
            return desktop;
        }

        static void DrawFaded(Graphics graphics, Bitmap picture, int left, int top, double opacity)
        {
            using (ImageAttributes attributes = new ImageAttributes())
            {
                ColorMatrix matrix = new ColorMatrix();
                matrix.Matrix33 = (float)Math.Max(0, Math.Min(1, opacity));
                attributes.SetColorMatrix(matrix, ColorMatrixFlag.Default, ColorAdjustType.Bitmap);
                graphics.DrawImage(picture, new Rectangle(left, top, picture.Width, picture.Height), 0, 0, picture.Width, picture.Height, GraphicsUnit.Pixel, attributes);
            }
        }

        /// The pill as it sits on a screen: the desktop, the glow at its full, the shadow, the pill.
        static void DrawPillScene(Graphics graphics, Monitor monitor, int sceneWidth, int sceneTop, double glow)
        {
            int left, top;
            double scale;
            using (Bitmap picture = PillPicture(monitor, out left, out top, out scale))
            using (Bitmap glowPicture = GlowPicture(sceneWidth, (int)Math.Round(sceneWidth * 0.5), scale))
            {
                DrawFaded(graphics, glowPicture, 0, sceneTop, glow);
                int sceneLeft = (sceneWidth - picture.Width) / 2;
                int y = sceneTop + (top - monitor.Bounds.Top);
                Bitmap shadow = ShadowPicture(picture.Width, picture.Height, scale);
                DrawFaded(graphics, shadow, sceneLeft - shadowMargin, y - shadowMargin, pillNow);
                DrawFaded(graphics, picture, sceneLeft, y, pillNow);
            }
        }

        static void SavePillOnDesktop(string dir, string file, Monitor monitor)
        {
            double scale = ScaleOf(monitor);
            int width = (int)Math.Round(720 * scale);
            int height = (int)Math.Round(96 * scale);
            using (Bitmap scene = DesktopTop(width, height, scale))
            {
                using (Graphics graphics = Graphics.FromImage(scene)) DrawPillScene(graphics, monitor, width, 0, glowNow);
                scene.Save(System.IO.Path.Combine(dir, file), ImageFormat.Png);
            }
        }

        /// Coming in (or going) a frame at a time, one scene under the other, with the time beside each.
        static void SaveFilm(string dir, string file, Monitor monitor, bool leaving)
        {
            double scale = ScaleOf(monitor);
            int width = (int)Math.Round(720 * scale);
            int frameHeight = (int)Math.Round(84 * scale);
            double[] times = leaving ? new double[] { 0, 0.06, 0.12, 0.18, 0.24, 0.3, 0.36, 0.42 } : new double[] { 0, 0.08, 0.16, 0.24, 0.32, 0.4, 0.5, 0.7 };
            double origin = Now();
            using (Bitmap film = new Bitmap(width, frameHeight * times.Length, PixelFormat.Format32bppArgb))
            using (Graphics graphics = Graphics.FromImage(film))
            using (Font label = new Font("Segoe UI", (float)(11 * scale), FontStyle.Regular, GraphicsUnit.Pixel))
            {
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                for (int index = 0; index < times.Length; index++)
                {
                    if (leaving)
                    {
                        // Going from fully there.
                        leaveAt = origin;
                        glowFrom = 1;
                        pillFrom = 1;
                        pointerFrom = 1;
                        dropFrom = 0;
                        growFrom = 1;
                    }
                    else
                    {
                        StartEntrance(origin);
                    }
                    Animate(origin + times[index]);
                    using (Bitmap scene = DesktopTop(width, frameHeight, scale))
                    {
                        using (Graphics sceneGraphics = Graphics.FromImage(scene)) DrawPillScene(sceneGraphics, monitor, width, 0, glowNow);
                        graphics.DrawImage(scene, 0, index * frameHeight);
                    }
                    using (SolidBrush ink = new SolidBrush(Color.FromArgb(200, 90, 94, 104)))
                        graphics.DrawString(((int)Math.Round(times[index] * 1000)) + " ms", label, ink, (float)(8 * scale), index * frameHeight + frameHeight - (float)(18 * scale));
                }
                film.Save(System.IO.Path.Combine(dir, file), ImageFormat.Png);
            }
            leaveAt = -1;
            glowNow = pillNow = pointerNow = 1;
            dropNow = 0;
            growNow = 1;
        }

        static void SaveCursorSample(string dir, string file)
        {
            string bare = System.IO.Path.Combine(dir, "bare-" + file);
            DrawPointer(bare);
            using (Bitmap cursor = new Bitmap(bare))
            using (Bitmap card = new Bitmap(cursor.Width * 2 + 24, cursor.Height + 16, PixelFormat.Format32bppArgb))
            {
                using (Graphics graphics = Graphics.FromImage(card))
                {
                    using (SolidBrush dark = new SolidBrush(Color.FromArgb(255, 32, 33, 36))) graphics.FillRectangle(dark, 0, 0, card.Width / 2, card.Height);
                    using (SolidBrush paper = new SolidBrush(Color.FromArgb(255, 245, 245, 247))) graphics.FillRectangle(paper, card.Width / 2, 0, card.Width / 2, card.Height);
                    graphics.DrawImage(cursor, 8, 8);
                    graphics.DrawImage(cursor, card.Width / 2 + 4, 8);
                }
                card.Save(System.IO.Path.Combine(dir, file), ImageFormat.Png);
            }
            System.IO.File.Delete(bare);
        }

        /* ---------------------------------------------------------------- */
        /* Small helpers                                                     */
        /* ---------------------------------------------------------------- */

        static GraphicsPath RoundedRect(Rectangle rect, int radius)
        {
            GraphicsPath path = new GraphicsPath();
            int diameter = Math.Min(radius * 2, Math.Min(rect.Width, rect.Height));
            if (diameter <= 0) { path.AddRectangle(rect); return path; }
            path.AddArc(rect.Left, rect.Top, diameter, diameter, 180, 90);
            path.AddArc(rect.Right - diameter, rect.Top, diameter, diameter, 270, 90);
            path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(rect.Left, rect.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }

        static Color Lighten(Color color)
        {
            return Color.FromArgb(color.A, color.R + (255 - color.R) * 2 / 5, color.G + (255 - color.G) * 2 / 5, color.B + (255 - color.B) * 2 / 5);
        }

        /// How light a colour looks, 0 to 1, so what is written on it can be dark on a light one.
        static double Luminance(Color color)
        {
            return (0.2126 * color.R + 0.7152 * color.G + 0.0722 * color.B) / 255.0;
        }

        static Color ParseColor(string hex, Color fallback)
        {
            if (string.IsNullOrEmpty(hex)) return fallback;
            string value = hex.Trim();
            if (value.StartsWith("#")) value = value.Substring(1);
            if (value.Length != 6) return fallback;
            try
            {
                return Color.FromArgb(255, Convert.ToInt32(value.Substring(0, 2), 16), Convert.ToInt32(value.Substring(2, 2), 16), Convert.ToInt32(value.Substring(4, 2), 16));
            }
            catch { return fallback; }
        }
    }
}
