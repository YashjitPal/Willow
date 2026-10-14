// Reading and working the user's windows the sighted way (screen-helper.cs): the open apps, the parts of one that can
// be acted on — a button, a box, a menu item — and acting on them by what they are, through Windows' own UI Automation,
// rather than by guessing at pixels. It is how the bot reaches a control it cannot see well, or works an app reliably.
//
// Nothing here moves the mouse or presses a key: invoking a button is Windows asking the app to do what a click would,
// so it never fights the user for the pointer. The same guards hold as everywhere — Willow's own windows are off
// limits — and a list of elements is numbered under a snapshot id, so an index never lands on the wrong thing once
// the app has changed. A window is read a level at a time, each level and everything worth knowing about its parts in
// one question to the app, and the helper runs each request on a thread it waits on only so long (Patience).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

namespace WillowScreen
{
    static class UiNative
    {
        public delegate bool EnumWindowsProc(IntPtr window, IntPtr data);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr data);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int max);
        [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr window);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr window);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
        [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr window, int index);
        [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint to, bool join);
        [DllImport("user32.dll")] public static extern bool PeekMessage(out MSG message, IntPtr window, uint min, uint max, uint remove);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    }

    static class UiAutomation
    {
        const int MAX_APPS = 40;
        const int MAX_ELEMENTS = 120;
        const int MAX_VISITED = 6000;

        // The last few element snapshots, each numbered, so an index the bot was given still points where it did. A
        // request the helper stopped waiting on may still finish on its own thread, so they are kept under a lock.
        static readonly object gate = new object();
        static readonly Dictionary<int, Snapshot> snapshots = new Dictionary<int, Snapshot>();
        static int snapshotCounter;

        class Snapshot
        {
            public IntPtr Window;
            public List<AutomationElement> Elements;
        }

        /* ---------------------------------------------------------------- */
        /* The open apps                                                     */
        /* ---------------------------------------------------------------- */

        public static object Apps()
        {
            IntPtr foreground = UiNative.GetForegroundWindow();
            List<object> apps = new List<object>();
            UiNative.EnumWindows(delegate (IntPtr window, IntPtr data)
            {
                if (apps.Count >= MAX_APPS) return false;
                if (!UiNative.IsWindowVisible(window)) return true;
                // Tool windows and those with no title are chrome, not apps the user would name.
                if ((UiNative.GetWindowLong(window, -20) & 0x00000080) != 0) return true;
                int length = UiNative.GetWindowTextLength(window);
                if (length == 0) return true;
                RECT rect;
                if (!UiNative.GetWindowRect(window, out rect)) return true;
                int width = rect.Right - rect.Left;
                int height = rect.Bottom - rect.Top;
                if (width < 80 || height < 80) return true;
                uint pid;
                UiNative.GetWindowThreadProcessId(window, out pid);
                string process = ProcessName(pid);
                if (Program.IsProtectedProcess(pid, process)) return true;
                if (process == "ShellExperienceHost" || process == "StartMenuExperienceHost" || process == "SearchHost" || process == "TextInputHost") return true;
                apps.Add(new Dictionary<string, object>
                {
                    { "title", Title(window) },
                    { "process", process },
                    { "pid", (int)pid },
                    { "bounds", Program.BoundsOf(rect) },
                    { "minimized", UiNative.IsIconic(window) },
                    { "foreground", window == foreground },
                });
                return true;
            }, IntPtr.Zero);
            return new Dictionary<string, object> { { "apps", apps } };
        }

        static string Title(IntPtr window)
        {
            int length = UiNative.GetWindowTextLength(window);
            StringBuilder text = new StringBuilder(length + 1);
            UiNative.GetWindowText(window, text, text.Capacity);
            return text.ToString();
        }

        static string ProcessName(uint pid)
        {
            try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
        }

        /* ---------------------------------------------------------------- */
        /* Which window a request means                                      */
        /* ---------------------------------------------------------------- */

        static IntPtr Resolve(Dictionary<string, object> request)
        {
            int pid = Program.IntOf(request, "pid", 0);
            string title = Program.TextOf(request, "title");
            string process = Program.TextOf(request, "process");
            if (pid == 0 && title.Length == 0 && process.Length == 0) return UiNative.GetForegroundWindow();

            IntPtr found = IntPtr.Zero;
            IntPtr foreground = UiNative.GetForegroundWindow();
            UiNative.EnumWindows(delegate (IntPtr window, IntPtr data)
            {
                if (!UiNative.IsWindowVisible(window) || UiNative.GetWindowTextLength(window) == 0) return true;
                uint windowPid;
                UiNative.GetWindowThreadProcessId(window, out windowPid);
                if (pid != 0 && windowPid != (uint)pid) return true;
                if (process.Length > 0 && !ProcessName(windowPid).Equals(process, StringComparison.OrdinalIgnoreCase)) return true;
                if (title.Length > 0 && Title(window).IndexOf(title, StringComparison.OrdinalIgnoreCase) < 0) return true;
                // The foreground window of the matches wins, else the first.
                if (window == foreground) { found = window; return false; }
                if (found == IntPtr.Zero) found = window;
                return true;
            }, IntPtr.Zero);
            return found;
        }

        static AutomationElement ElementOf(IntPtr window)
        {
            try { return AutomationElement.FromHandle(window); } catch { return null; }
        }

        /* ---------------------------------------------------------------- */
        /* The parts of a window that can be acted on                        */
        /* ---------------------------------------------------------------- */

        public static object Elements(Dictionary<string, object> request)
        {
            IntPtr window = Resolve(request);
            if (window == IntPtr.Zero) throw new Exception("No window like that is open. Call user_apps to see what is.");
            uint pid;
            UiNative.GetWindowThreadProcessId(window, out pid);
            if (Program.IsProtectedProcess(pid, ProcessName(pid))) throw new Refusal("willow", "That is Willow's own window, which a bot never acts on.");
            Program.CheckReachable(window);
            AutomationElement root = ElementOf(window);
            if (root == null) throw new Exception("That window could not be read.");

            List<AutomationElement> collected = new List<AutomationElement>();
            List<object> described = new List<object>();
            Walk(root, collected, described);

            int id;
            lock (gate)
            {
                id = ++snapshotCounter;
                snapshots[id] = new Snapshot { Window = window, Elements = collected };
                // Keep only the last two snapshots: older indices are not worth the memory.
                while (snapshots.Count > 2)
                {
                    int oldest = int.MaxValue;
                    foreach (int key in snapshots.Keys) if (key < oldest) oldest = key;
                    snapshots.Remove(oldest);
                }
            }

            RECT rect;
            UiNative.GetWindowRect(window, out rect);
            return new Dictionary<string, object>
            {
                { "snapshot", id },
                { "window", Title(window) },
                { "process", ProcessName(pid) },
                { "bounds", Program.BoundsOf(rect) },
                { "truncated", collected.Count >= MAX_ELEMENTS },
                { "elements", described },
            };
        }

        // What is read of each element, in the same question as the element itself.
        static readonly AutomationProperty[] Read = new AutomationProperty[]
        {
            AutomationElement.NameProperty, AutomationElement.ControlTypeProperty, AutomationElement.IsOffscreenProperty,
            AutomationElement.BoundingRectangleProperty, AutomationElement.IsKeyboardFocusableProperty, AutomationElement.IsEnabledProperty,
            AutomationElement.IsInvokePatternAvailableProperty, AutomationElement.IsTogglePatternAvailableProperty,
            AutomationElement.IsSelectionItemPatternAvailableProperty, AutomationElement.IsExpandCollapsePatternAvailableProperty,
            AutomationElement.IsValuePatternAvailableProperty, ValuePattern.ValueProperty, ValuePattern.IsReadOnlyProperty,
            TogglePattern.ToggleStateProperty, SelectionItemPattern.IsSelectedProperty, ExpandCollapsePattern.ExpandCollapseStateProperty,
        };

        /// An element's children in the control view, each with what is read of it, in one question to the app.
        static CacheRequest Level()
        {
            CacheRequest request = new CacheRequest();
            request.TreeFilter = Automation.ControlViewCondition;
            request.TreeScope = TreeScope.Element | TreeScope.Children;
            foreach (AutomationProperty property in Read) request.Add(property);
            return request;
        }

        static void Walk(AutomationElement root, List<AutomationElement> collected, List<object> described)
        {
            CacheRequest level = Level();
            Stack<AutomationElement> stack = new Stack<AutomationElement>();
            // Depth-first from the window's own children, so reading order roughly follows the layout.
            PushChildren(stack, root, level);
            int visited = 0;
            while (stack.Count > 0 && collected.Count < MAX_ELEMENTS && visited < MAX_VISITED)
            {
                AutomationElement element = stack.Pop();
                visited++;
                try
                {
                    if (Flag(element, AutomationElement.IsOffscreenProperty)) continue;
                    object description = Describe(element, collected.Count);
                    if (description != null)
                    {
                        collected.Add(element);
                        described.Add(description);
                    }
                    PushChildren(stack, element, level);
                }
                catch { }
            }
        }

        static void PushChildren(Stack<AutomationElement> stack, AutomationElement element, CacheRequest level)
        {
            AutomationElementCollection children;
            try { children = element.GetUpdatedCache(level).CachedChildren; } catch { return; }
            if (children == null) return;
            for (int index = children.Count - 1; index >= 0; index--) stack.Push(children[index]);
        }

        static object Cached(AutomationElement element, AutomationProperty property)
        {
            object value;
            try { value = element.GetCachedPropertyValue(property, true); } catch { return null; }
            return value == AutomationElement.NotSupported ? null : value;
        }

        static bool Flag(AutomationElement element, AutomationProperty property)
        {
            object value = Cached(element, property);
            return value is bool && (bool)value;
        }

        static readonly Dictionary<int, string> ControlNames = BuildControlNames();

        static object Describe(AutomationElement element, int index)
        {
            List<string> actions = new List<string>();
            bool toggles = Flag(element, AutomationElement.IsTogglePatternAvailableProperty);
            bool selects = Flag(element, AutomationElement.IsSelectionItemPatternAvailableProperty);
            bool expands = Flag(element, AutomationElement.IsExpandCollapsePatternAvailableProperty);
            bool hasValue = Flag(element, AutomationElement.IsValuePatternAvailableProperty);
            if (Flag(element, AutomationElement.IsInvokePatternAvailableProperty)) actions.Add("invoke");
            if (toggles) actions.Add("toggle");
            if (selects) actions.Add("select");
            if (expands) actions.Add("expand");
            if (hasValue && !Flag(element, ValuePattern.IsReadOnlyProperty)) actions.Add("set_value");

            ControlType type = Cached(element, AutomationElement.ControlTypeProperty) as ControlType;
            int typeId = type == null ? 0 : type.Id;
            string name = ((Cached(element, AutomationElement.NameProperty) as string) ?? "").Trim();

            // Worth listing: something the bot can do to it, or a named label/text it may need to read or point near.
            bool interactive = actions.Count > 0;
            bool readable = name.Length > 0 && (typeId == ControlType.Text.Id || typeId == ControlType.Image.Id || typeId == ControlType.ListItem.Id || typeId == ControlType.TreeItem.Id || typeId == ControlType.TabItem.Id);
            if (!interactive && !readable) return null;

            object rect = Cached(element, AutomationElement.BoundingRectangleProperty);
            System.Windows.Rect box = rect is System.Windows.Rect ? (System.Windows.Rect)rect : System.Windows.Rect.Empty;
            Dictionary<string, object> bounds = null;
            if (!box.IsEmpty && box.Width > 0 && box.Height > 0)
            {
                bounds = new Dictionary<string, object>
                {
                    { "x", (int)Math.Round(box.X + box.Width / 2) },
                    { "y", (int)Math.Round(box.Y + box.Height / 2) },
                    { "left", (int)Math.Round(box.X) },
                    { "top", (int)Math.Round(box.Y) },
                    { "width", (int)Math.Round(box.Width) },
                    { "height", (int)Math.Round(box.Height) },
                };
            }

            Dictionary<string, object> described = new Dictionary<string, object>
            {
                { "index", index },
                { "role", ControlNames.ContainsKey(typeId) ? ControlNames[typeId] : "element" },
                { "name", name.Length > 160 ? name.Substring(0, 159) + "\u2026" : name },
            };
            if (actions.Count > 0) described["actions"] = actions;
            if (bounds != null) described["center"] = bounds;
            if (Flag(element, AutomationElement.IsKeyboardFocusableProperty)) described["focusable"] = true;
            object enabled = Cached(element, AutomationElement.IsEnabledProperty);
            if (enabled is bool && !(bool)enabled) described["disabled"] = true;

            object toggle = toggles ? Cached(element, TogglePattern.ToggleStateProperty) : null;
            object selected = selects ? Cached(element, SelectionItemPattern.IsSelectedProperty) : null;
            object expansion = expands ? Cached(element, ExpandCollapsePattern.ExpandCollapseStateProperty) : null;
            if (toggle is ToggleState) described["state"] = toggle.ToString().ToLowerInvariant();
            else if (selected is bool) described["state"] = (bool)selected ? "selected" : "not-selected";
            else if (expansion is ExpandCollapseState && (ExpandCollapseState)expansion != ExpandCollapseState.LeafNode) described["state"] = expansion.ToString().ToLowerInvariant();

            if (hasValue)
            {
                string value = (Cached(element, ValuePattern.ValueProperty) as string) ?? "";
                if (value.Length > 0) described["value"] = value.Length > 200 ? value.Substring(0, 199) + "\u2026" : value;
            }
            return described;
        }

        /* ---------------------------------------------------------------- */
        /* Acting on one                                                     */
        /* ---------------------------------------------------------------- */

        public static object Act(Dictionary<string, object> request)
        {
            int id = Program.IntOf(request, "snapshot", 0);
            int index = Program.IntOf(request, "index", -1);
            string what = Program.TextOf(request, "action").ToLowerInvariant();
            Snapshot snapshot;
            lock (gate)
            {
                if (!snapshots.TryGetValue(id, out snapshot)) throw new Exception("That list of elements is out of date. Call user_elements again for a fresh one.");
            }
            if (index < 0 || index >= snapshot.Elements.Count) throw new Exception("There is no element " + index + " in that list.");

            uint pid;
            UiNative.GetWindowThreadProcessId(snapshot.Window, out pid);
            if (Program.IsProtectedProcess(pid, ProcessName(pid))) throw new Refusal("willow", "That is Willow's own window, which a bot never acts on.");
            Program.CheckReachable(snapshot.Window);

            AutomationElement element = snapshot.Elements[index];
            object pattern;
            try
            {
                if (!element.Current.IsEnabled) throw new Exception("That control is disabled right now, so nothing was done.");
                if (what == "invoke" || what == "")
                {
                    // What a click would do, by the means the control has: pressed, toggled, chosen, or opened and closed.
                    if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) ((InvokePattern)pattern).Invoke();
                    else if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) ((TogglePattern)pattern).Toggle();
                    else if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) ((SelectionItemPattern)pattern).Select();
                    else if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern))
                    {
                        ExpandCollapsePattern expander = (ExpandCollapsePattern)pattern;
                        if (expander.Current.ExpandCollapseState == ExpandCollapseState.Expanded) expander.Collapse(); else expander.Expand();
                    }
                    else throw new Exception("That control cannot be pressed this way. Click it at its position instead.");
                }
                else if (what == "toggle")
                {
                    if (!element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) throw new Exception("That element cannot be toggled.");
                    ((TogglePattern)pattern).Toggle();
                }
                else if (what == "select")
                {
                    if (!element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) throw new Exception("That element cannot be selected.");
                    ((SelectionItemPattern)pattern).Select();
                }
                else if (what == "expand" || what == "collapse")
                {
                    if (!element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) throw new Exception("That element does not expand.");
                    if (what == "expand") ((ExpandCollapsePattern)pattern).Expand(); else ((ExpandCollapsePattern)pattern).Collapse();
                }
                else if (what == "set_value")
                {
                    if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) throw new Exception("That element has no value to set. Click it and type instead.");
                    ValuePattern value = (ValuePattern)pattern;
                    if (value.Current.IsReadOnly) throw new Exception("That value cannot be changed.");
                    try { element.SetFocus(); } catch { }
                    value.SetValue(Program.TextOf(request, "value"));
                }
                else throw new Exception("Unknown action \"" + what + "\". Use invoke, toggle, select, expand, collapse or set_value.");
            }
            catch (ElementNotAvailableException)
            {
                throw new Exception("That element is gone — the app changed. Call user_elements again.");
            }
            catch (ElementNotEnabledException)
            {
                throw new Exception("That control is disabled right now, so nothing was done.");
            }

            string name = "";
            try { name = (element.Current.Name ?? "").Trim(); } catch { }
            return new Dictionary<string, object> { { "ok", true }, { "name", name } };
        }

        /* ---------------------------------------------------------------- */
        /* Bringing a window to the front                                    */
        /* ---------------------------------------------------------------- */

        public static object Focus(Dictionary<string, object> request)
        {
            IntPtr window = Resolve(request);
            if (window == IntPtr.Zero) throw new Exception("No window like that is open. Call user_apps to see what is.");
            uint pid;
            UiNative.GetWindowThreadProcessId(window, out pid);
            if (Program.IsProtectedProcess(pid, ProcessName(pid))) throw new Refusal("willow", "That is Willow's own window, which a bot never brings forward.");
            if (UiNative.IsIconic(window)) UiNative.ShowWindow(window, 9);
            // A message queue of this thread's own, which borrowing another's input needs.
            MSG message;
            UiNative.PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
            // Windows only lets the foreground thread change the foreground window; borrow its input queue to do it.
            uint current = UiNative.GetCurrentThreadId();
            uint other = UiNative.GetWindowThreadProcessId(UiNative.GetForegroundWindow(), out pid);
            bool attached = other != 0 && other != current && UiNative.AttachThreadInput(current, other, true);
            try
            {
                UiNative.SetForegroundWindow(window);
                UiNative.BringWindowToTop(window);
            }
            finally { if (attached) UiNative.AttachThreadInput(current, other, false); }
            // Still held back by Windows' foreground lock: it gives way while Alt is down.
            if (UiNative.GetForegroundWindow() != window) Program.WithAlt(delegate { UiNative.SetForegroundWindow(window); });
            bool now = UiNative.GetForegroundWindow() == window;
            return new Dictionary<string, object> { { "ok", true }, { "foreground", now }, { "title", Title(window) } };
        }

        static Dictionary<int, string> BuildControlNames()
        {
            return new Dictionary<int, string>
            {
                { ControlType.Button.Id, "button" }, { ControlType.CheckBox.Id, "checkbox" }, { ControlType.RadioButton.Id, "radio" },
                { ControlType.ComboBox.Id, "combobox" }, { ControlType.Edit.Id, "textbox" }, { ControlType.Document.Id, "document" },
                { ControlType.Hyperlink.Id, "link" }, { ControlType.Image.Id, "image" }, { ControlType.ListItem.Id, "list item" },
                { ControlType.List.Id, "list" }, { ControlType.Menu.Id, "menu" }, { ControlType.MenuItem.Id, "menu item" },
                { ControlType.ProgressBar.Id, "progress" }, { ControlType.ScrollBar.Id, "scrollbar" }, { ControlType.Slider.Id, "slider" },
                { ControlType.Spinner.Id, "spinner" }, { ControlType.Tab.Id, "tabs" }, { ControlType.TabItem.Id, "tab" },
                { ControlType.Text.Id, "text" }, { ControlType.ToolBar.Id, "toolbar" }, { ControlType.Tree.Id, "tree" },
                { ControlType.TreeItem.Id, "tree item" }, { ControlType.Group.Id, "group" }, { ControlType.Pane.Id, "pane" },
                { ControlType.Window.Id, "window" }, { ControlType.SplitButton.Id, "split button" }, { ControlType.Custom.Id, "control" },
            };
        }
    }
}
