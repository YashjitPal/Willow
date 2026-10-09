// Reading and working the user's windows the sighted way (screen-helper.cs): the open apps, the parts of one that can
// be acted on — a button, a box, a menu item — and acting on them by what they are, through Windows' own UI Automation,
// rather than by guessing at pixels. It is how the bot reaches a control it cannot see well, or works an app reliably.
//
// Nothing here moves the mouse or presses a key: invoking a button is Windows asking the app to do what a click would,
// so it never fights the user for the pointer. The same guards hold as everywhere — Willow's own windows are off
// limits — and a list of elements is numbered under a snapshot id, so an index never lands on the wrong thing once
// the app has changed.
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
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
        [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr window, int index);
        [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint to, bool join);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    }

    static class UiAutomation
    {
        const int MAX_APPS = 40;
        const int MAX_ELEMENTS = 120;
        const int MAX_VISITED = 6000;

        // The last few element snapshots, each numbered, so an index the bot was given still points where it did.
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
            AutomationElement root = ElementOf(window);
            if (root == null) throw new Exception("That window could not be read.");

            List<AutomationElement> collected = new List<AutomationElement>();
            List<object> described = new List<object>();
            Walk(root, collected, described);

            int id = ++snapshotCounter;
            snapshots[id] = new Snapshot { Window = window, Elements = collected };
            // Keep only the last two snapshots: older indices are not worth the memory.
            if (snapshots.Count > 2)
            {
                int oldest = int.MaxValue;
                foreach (int key in snapshots.Keys) if (key < oldest) oldest = key;
                snapshots.Remove(oldest);
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

        static void Walk(AutomationElement root, List<AutomationElement> collected, List<object> described)
        {
            TreeWalker walker = TreeWalker.ControlViewWalker;
            Stack<AutomationElement> stack = new Stack<AutomationElement>();
            // Depth-first from the window's own children, so reading order roughly follows the layout.
            List<AutomationElement> children = new List<AutomationElement>();
            try
            {
                AutomationElement child = walker.GetFirstChild(root);
                while (child != null) { children.Add(child); child = walker.GetNextSibling(child); }
            }
            catch { }
            for (int index = children.Count - 1; index >= 0; index--) stack.Push(children[index]);

            int visited = 0;
            while (stack.Count > 0 && collected.Count < MAX_ELEMENTS && visited < MAX_VISITED)
            {
                AutomationElement element = stack.Pop();
                visited++;
                try
                {
                    if ((bool)element.GetCurrentPropertyValue(AutomationElement.IsOffscreenProperty)) continue;
                    object description = Describe(element, collected.Count);
                    if (description != null)
                    {
                        collected.Add(element);
                        described.Add(description);
                    }
                    List<AutomationElement> kids = new List<AutomationElement>();
                    AutomationElement kid = walker.GetFirstChild(element);
                    while (kid != null) { kids.Add(kid); kid = walker.GetNextSibling(kid); }
                    for (int index = kids.Count - 1; index >= 0; index--) stack.Push(kids[index]);
                }
                catch { }
            }
        }

        static readonly Dictionary<int, string> ControlNames = BuildControlNames();

        static object Describe(AutomationElement element, int index)
        {
            List<string> actions = new List<string>();
            object pattern;
            if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) actions.Add("invoke");
            if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) actions.Add("toggle");
            if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) actions.Add("select");
            if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) actions.Add("expand");
            bool editable = element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) && !((ValuePattern)pattern).Current.IsReadOnly;
            if (editable) actions.Add("set_value");

            ControlType type = element.Current.ControlType;
            int typeId = type == null ? 0 : type.Id;
            string name = (element.Current.Name ?? "").Trim();
            bool keyboardFocusable = element.Current.IsKeyboardFocusable;

            // Worth listing: something the bot can do to it, or a named label/text it may need to read or point near.
            bool interactive = actions.Count > 0;
            bool readable = name.Length > 0 && (typeId == ControlType.Text.Id || typeId == ControlType.Image.Id || typeId == ControlType.ListItem.Id || typeId == ControlType.TreeItem.Id || typeId == ControlType.TabItem.Id);
            if (!interactive && !readable) return null;
            if (name.Length == 0 && !interactive) return null;

            System.Windows.Rect box = element.Current.BoundingRectangle;
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
            if (keyboardFocusable) described["focusable"] = true;

            if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern))
                described["state"] = ((TogglePattern)pattern).Current.ToggleState.ToString().ToLowerInvariant();
            else if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern))
                described["state"] = ((SelectionItemPattern)pattern).Current.IsSelected ? "selected" : "not-selected";
            else if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern))
                described["state"] = ((ExpandCollapsePattern)pattern).Current.ExpandCollapseState.ToString().ToLowerInvariant();

            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
            {
                string value = ((ValuePattern)pattern).Current.Value ?? "";
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
            if (!snapshots.ContainsKey(id)) throw new Exception("That list of elements is out of date. Call user_elements again for a fresh one.");
            Snapshot snapshot = snapshots[id];
            if (index < 0 || index >= snapshot.Elements.Count) throw new Exception("There is no element " + index + " in that list.");

            uint pid;
            UiNative.GetWindowThreadProcessId(snapshot.Window, out pid);
            if (Program.IsProtectedProcess(pid, ProcessName(pid))) throw new Refusal("willow", "That is Willow's own window, which a bot never acts on.");

            AutomationElement element = snapshot.Elements[index];
            object pattern;
            try
            {
                if (what == "invoke" || what == "")
                {
                    if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) { ((InvokePattern)pattern).Invoke(); }
                    else if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) { ((SelectionItemPattern)pattern).Select(); }
                    else throw new Exception("That element cannot be invoked. Read its \"actions\" for what it takes.");
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
            // Windows only lets the foreground thread change the foreground window; borrow its input queue to do it.
            uint current = UiNative.GetCurrentThreadId();
            uint other = UiNative.GetWindowThreadProcessId(UiNative.GetForegroundWindow(), out pid);
            bool attached = other != 0 && other != current && UiNative.AttachThreadInput(current, other, true);
            try { UiNative.SetForegroundWindow(window); }
            finally { if (attached) UiNative.AttachThreadInput(current, other, false); }
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

