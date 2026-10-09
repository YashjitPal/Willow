import { defineMessages } from "react-intl";

export const pageMessages = defineMessages({
  contentLoading: {
    id: "codex.space.page.contentLoading",
    defaultMessage: "Loading page content",
    description: "Accessible status announced while a Page's collaborative document loads beneath its already visible title in the Space",
  },
  loadFailed: {
    id: "codex.space.page.loadFailed",
    defaultMessage: "This page could not be opened",
    description: "Error shown when the user opens a Page in the Space and its document cannot be loaded or they do not have access",
  },
  editorLabel: {
    id: "codex.space.page.editorLabel",
    defaultMessage: "Page document",
    description: "Accessible label for the rich-text Markdown writing editor used to edit the complete contents of a Page in the Space",
  },
  editorPlaceholder: {
    id: "codex.space.page.editorPlaceholder",
    defaultMessage: "Type / for commands or @ for files and mentions",
    description: "Placeholder in an empty Space Page document explaining that slash opens commands and the at sign opens files and mentions",
  },
  titleLabel: {
    id: "codex.space.page.titleLabel",
    defaultMessage: "Page title",
    description: "Accessible label for the editable title input above a Page document in the Space",
  },
  untitled: {
    id: "codex.space.page.untitledRow",
    defaultMessage: "Untitled page",
    description: "Fallback title for a Page without a title, used in its title input, navigation, lists, and links",
  },
  changeSymbol: {
    id: "codex.space.page.symbol.change",
    defaultMessage: "Change icon",
    description: "Accessible label and tooltip for the shared Page and Space symbol picker beside the title",
  },
  saved: {
    id: "codex.space.page.saved",
    defaultMessage: "Saved",
    description: "Status above a connected shared Page editor when all local edits have been confirmed in the canonical saved document and no changes remain pending",
  },
  readOnlyLabel: {
    id: "codex.space.page.readOnly.label",
    defaultMessage: "View only",
    description: "Screen reader status label for the lock icon in the shared Page toolbar when the user lacks permission to edit its content; this does not describe its connection status or prohibit otherwise allowed comments",
  },
  readOnlyExplanation: {
    id: "codex.space.page.readOnly.explanation",
    defaultMessage: "You don't have permission to edit this page",
    description: "Tooltip on the shared Page toolbar's view-only status when the user lacks permission to edit its title or document; viewing, copying, and permitted comments remain available",
  },
  requestChangesLabel: {
    id: "codex.space.page.requestChanges.label",
    defaultMessage: "Ask for changes",
    description: "Screen reader status for a Page that offers an inline change-request composer while direct content editing is disabled",
  },
  requestChangesExplanation: {
    id: "codex.space.page.requestChanges.explanation",
    defaultMessage: "Select text to describe a change. Direct editing is disabled",
    description: "Tooltip on the Page toolbar lock when the user can open the change-request composer but cannot directly edit the title or document",
  },
  documentTitle: {
    id: "codex.space.page.documentTitle",
    defaultMessage: "{title} - Willow",
    description:
      "Browser tab title while viewing a document in Space. The title placeholder is the user-authored document name and updates as it changes. Keep ChatGPT as the product name.",
  },
  emptyDocumentTitle: {
    id: "codex.space.page.emptyDocumentTitle",
    defaultMessage: "Willow",
    description: "Browser tab title for a document in Space that has no name; keep the ChatGPT product name unchanged",
  },
});

export const headerMessages = defineMessages({
  editingTools: {
    id: "codex.space.page.header.editingTools",
    defaultMessage: "Page editing tools",
    description: "Accessible label for the Page header editing actions",
  },
  comments: {
    id: "codex.space.page.header.comments",
    defaultMessage: "Comments",
    description: "Accessible label for the Page header comments control",
  },
  sharing: {
    id: "codex.space.page.header.sharing",
    defaultMessage: "Sharing",
    description: "Accessible label for Page sharing controls",
  },
  generate: {
    id: "codex.space.page.header.generate",
    defaultMessage: "Generate",
    description: "Open a prompt to generate content in the Page",
  },
  image: {
    id: "codex.space.page.header.image",
    defaultMessage: "Image",
    description: "Insert an image block into the Page",
  },
  visualize: {
    id: "codex.space.page.header.visualize",
    defaultMessage: "Visualize",
    description: "Open a prompt to create a visualization in the Page",
  },
  insert: {
    id: "codex.space.page.header.insert",
    defaultMessage: "Insert",
    description: "Label for the Page toolbar menu that inserts a block after the current block",
  },
  copyLink: {
    id: "codex.space.page.header.copyLink",
    defaultMessage: "Copy link",
    description: "Tooltip and accessible label for the Page header button that copies the current Page's URL to the clipboard",
  },
  toggleComments: {
    id: "codex.space.page.comments.toggleSidebar",
    defaultMessage: "Show comments",
    description: "Accessible label and tooltip for the Page header button that opens the comments sidebar",
  },
  attributionToggle: {
    id: "codex.space.page.attribution.toggle",
    defaultMessage: "Show attribution",
    description: "Page action menu option that shows who last edited each block in the shared Page document",
  },
  activity: {
    id: "codex.space.page.actions.activity",
    defaultMessage: "Page activity",
    description: "Page menu action opening saved versions, recent edits, and permitted view history",
  },
});

export const commentMessages = defineMessages({
  submitReply: {
    id: "codex.space.page.comments.submitReply",
    defaultMessage: "Reply",
    description: "Button that posts a reply to a shared Page comment thread",
  },
  submit: {
    id: "codex.space.page.comments.submit",
    defaultMessage: "Comment",
    description: "Button that posts the first comment on selected text in a shared Page",
  },
  body: {
    id: "codex.space.page.comments.body",
    defaultMessage: "Comment",
    description: "Accessible label for typing a new comment or reply on a shared Page",
  },
  placeholder: {
    id: "codex.space.page.comments.placeholder",
    defaultMessage: "Reply…",
    description: "Placeholder for writing a reply to a shared Page comment thread",
  },
  createPlaceholder: {
    id: "codex.space.page.comments.createPlaceholder",
    defaultMessage: "Add a comment…",
    description: "Placeholder for writing the first comment on selected text in a shared Page",
  },
  detached: {
    id: "codex.space.page.comments.detached",
    defaultMessage: "Original text unavailable",
    description: "Quiet heading above Page comments whose original text can no longer be located; the discussions remain open",
  },
  resolvedHeading: {
    id: "codex.space.page.comments.resolvedHeading",
    defaultMessage: "Resolved",
    description: "Heading and toggle for resolved Page comment threads",
  },
  closeSidebar: {
    id: "codex.space.page.comments.closeSidebar",
    defaultMessage: "Close comments",
    description: "Close the Page comments sidebar and return to floating comments",
  },
  sidebarHeading: {
    id: "codex.space.page.comments.sidebarHeading",
    defaultMessage: "Comments",
    description: "Heading of the Page comments sidebar",
  },
  sidebar: {
    id: "codex.space.page.comments.sidebar",
    defaultMessage: "Page comments",
    description: "Accessible label for the Page comments sidebar",
  },
  empty: {
    id: "codex.space.page.comments.empty",
    defaultMessage: "No comments yet",
    description: "Empty state in the Page comments sidebar",
  },
  emptyDescription: {
    id: "codex.space.page.comments.emptyDescription",
    defaultMessage: "Select text to add a comment",
    description: "How to start a comment when the Page comments sidebar is empty",
  },
  more: {
    id: "codex.space.page.comments.more",
    defaultMessage: "Read more",
    description: "Expands the clipped text of one Page comment or reply to show its full message",
  },
  actions: {
    id: "codex.space.page.comments.actions",
    defaultMessage: "Comment actions",
    description: "Opens the edit and delete menu for a Page comment",
  },
  confirmDeleteThread: {
    id: "codex.space.page.comments.confirmDeleteThread",
    defaultMessage: "Delete this thread?",
    description: "Confirmation title for deleting an entire Page comment thread",
  },
  confirmDeleteMessage: {
    id: "codex.space.page.comments.confirmDeleteMessage",
    defaultMessage: "Delete this comment?",
    description: "Confirmation title for replacing a Page comment with a tombstone",
  },
  edit: {
    id: "codex.space.page.comments.edit",
    defaultMessage: "Edit comment",
    description: "Edits the caller's own Page comment",
  },
  deleteMessage: {
    id: "codex.space.page.comments.deleteMessage",
    defaultMessage: "Delete comment",
    description: "Replaces the caller's own Page comment with a tombstone, retaining replies",
  },
  deleteThread: {
    id: "codex.space.page.comments.deleteThread",
    defaultMessage: "Delete thread",
    description: "Removes a Page discussion containing only the caller's messages",
  },
  deleteThreadDescription: {
    id: "codex.space.page.comments.deleteThreadDescription",
    defaultMessage: "This removes the thread and all its messages",
    description: "Explains the effect of deleting a Page thread containing only the caller's messages",
  },
  deleteMessageDescription: {
    id: "codex.space.page.comments.deleteMessageDescription",
    defaultMessage: "The comment text will be removed, but replies will remain",
    description: "Explains that deleting a Page message preserves its thread and replies",
  },
  cancelEdit: {
    id: "codex.space.page.comments.cancelEdit",
    defaultMessage: "Cancel",
    description: "Cancels editing or deleting a Page comment",
  },
  confirmDelete: {
    id: "codex.space.page.comments.confirmDelete",
    defaultMessage: "Delete",
    description: "Confirms deletion of a Page comment or thread",
  },
  editBody: {
    id: "codex.space.page.comments.editBody",
    defaultMessage: "Comment text",
    description: "Accessible label for editing a Page comment's text",
  },
  saveEdit: {
    id: "codex.space.page.comments.saveEdit",
    defaultMessage: "Save",
    description: "Saves edits to the caller's Page comment",
  },
  agentInitiator: {
    id: "codex.space.page.comments.agentInitiator",
    defaultMessage: "Initiated by {knownAuthor, select, true {{authorName}} other {a collaborator}}",
    description: "Accessible label and tooltip for the human avatar badge on an AI-authored Page comment; never expose an unresolved account ID",
  },
  agentAuthorWithInitiator: {
    id: "codex.space.page.comments.agentAuthorWithInitiator",
    defaultMessage: "Willow, initiated by {knownAuthor, select, true {{authorName}} other {a collaborator}}",
    description: "Accessible name of the ChatGPT author and avatar tooltip trigger on an agent-authored Page comment, including the responsible human when known",
  },
  chatgptAuthor: {
    id: "codex.space.page.comments.chatgptAuthor",
    defaultMessage: "Willow",
    description: "Name of the AI author of a shared Page comment",
  },
  author: {
    id: "codex.space.page.comments.author",
    defaultMessage: "{viewer, select, true {You} other {{knownAuthor, select, true {{authorName}} other {Collaborator}}}}",
    description: "Author of a Page comment: You for the verified current viewer, or Collaborator when their name is unavailable",
  },
  edited: {
    id: "codex.space.page.comments.edited",
    defaultMessage: "Edited",
    description: "Indicates that a Page comment was edited by its author",
  },
  reactionPeople: {
    id: "codex.space.page.comments.reactionPeople",
    defaultMessage: "{emoji} {people}",
    description: "Tooltip identifying an emoji reaction and the names of people who reacted to a shared Page comment",
  },
  reactionCountWithEmoji: {
    id: "codex.space.page.comments.reactionCountWithEmoji",
    defaultMessage: "{emoji} {count, plural, one {# reaction} other {# reactions}}",
    description: "Tooltip identifying an emoji reaction and how many people used it on a shared Page comment when their names are unavailable",
  },
  addReaction: {
    id: "codex.space.page.comments.addReaction",
    defaultMessage: "Add reaction",
    description: "Accessible label for opening the emoji reaction picker for a shared Page comment",
  },
  reaction: {
    id: "codex.space.page.comments.reaction",
    defaultMessage: "{emoji} reaction",
    description: "Accessible label for toggling an emoji reaction on a shared Page comment",
  },
  showReplies: {
    id: "codex.space.page.comments.showReplies",
    defaultMessage: "Show {count, plural, one {# reply} other {# replies}}",
    description: "Reveals older hidden replies between the original Page comment and its latest visible reply; the count excludes the original and latest messages",
  },
  resolve: {
    id: "codex.space.page.comments.resolve",
    defaultMessage: "Resolve comment",
    description: "Resolves a shared Page comment thread",
  },
  thread: {
    id: "codex.space.page.comments.thread",
    defaultMessage: "Comment thread",
    description: "Accessible group containing a Page discussion and its reply field",
  },
  selectThread: {
    id: "codex.space.page.comments.selectThread",
    defaultMessage: "Select comment thread",
    description: "Selects or deselects a Page discussion to show its reply field and align it with its original text",
  },
  resolvedStatus: {
    id: "codex.space.page.comments.resolvedStatus",
    defaultMessage: "Resolved{hasDate, select, true { · {time}} other {}}",
    description: "Resolution status below a Page discussion, with the relative time when known",
  },
  reopen: {
    id: "codex.space.page.comments.reopen",
    defaultMessage: "Reopen",
    description: "Reopens a resolved shared Page comment thread so collaborators can reply again",
  },
  rail: {
    id: "codex.space.page.comments.rail",
    defaultMessage: "Page comments",
    description: "Accessible label for the document-aligned comments rail",
  },
  saveError: {
    id: "codex.space.page.comments.saveError",
    defaultMessage: "Could not save comment",
    description: "Toast displayed when creating, replying to, resolving, or reopening a comment on a shared Page fails",
  },
  copyUnsent: {
    id: "codex.space.page.comments.copyUnsent",
    defaultMessage: "Copy comment",
    description: "Copies the submitted comment text after saving fails, without replacing a newer draft",
  },
  toggleSidebar: {
    id: "codex.space.page.comments.toggleSidebar",
    defaultMessage: "Show comments",
    description: "Accessible label and tooltip for the Page header button that opens the comments sidebar",
  },
  commentOnSelection: {
    id: "selectedTextOverlay.comment",
    defaultMessage: "Comment",
    description: "Button label for commenting on the currently selected text",
  },
});

export const controlMessages = defineMessages({
  turnIntoLabel: {
    id: "codex.space.page.controls.turnInto.label",
    defaultMessage: "Turn into",
    description: "Opens the Page block menu's submenu for converting the targeted block to another text, heading, list, quote, or code style",
  },
  turnIntoText: {
    id: "codex.space.page.controls.turnInto.text",
    defaultMessage: "Text",
    description: "Option in the Page block Turn into submenu that converts the block to an ordinary text paragraph",
  },
  turnIntoHeading1: {
    id: "codex.space.page.controls.turnInto.heading1",
    defaultMessage: "Heading 1",
    description: "Option in the Page block Turn into submenu that converts the block to a level-one heading",
  },
  turnIntoHeading2: {
    id: "codex.space.page.controls.turnInto.heading2",
    defaultMessage: "Heading 2",
    description: "Option in the Page block Turn into submenu that converts the block to a level-two heading",
  },
  turnIntoHeading3: {
    id: "codex.space.page.controls.turnInto.heading3",
    defaultMessage: "Heading 3",
    description: "Option in the Page block Turn into submenu that converts the block to a level-three heading",
  },
  turnIntoHeading4: {
    id: "codex.space.page.controls.turnInto.heading4",
    defaultMessage: "Heading 4",
    description: "Option in the Page block Turn into submenu that converts the block to a level-four heading",
  },
  turnIntoHeading5: {
    id: "codex.space.page.controls.turnInto.heading5",
    defaultMessage: "Heading 5",
    description: "Option in the Page block Turn into submenu that converts the block to a level-five heading",
  },
  turnIntoHeading6: {
    id: "codex.space.page.controls.turnInto.heading6",
    defaultMessage: "Heading 6",
    description: "Option in the Page block Turn into submenu that converts the block to a level-six heading",
  },
  turnIntoBulletedList: {
    id: "codex.space.page.controls.turnInto.bulletedList",
    defaultMessage: "Bulleted list",
    description: "Option in the Page block Turn into submenu that converts the block to a bulleted list item",
  },
  turnIntoNumberedList: {
    id: "codex.space.page.controls.turnInto.numberedList",
    defaultMessage: "Numbered list",
    description: "Option in the Page block Turn into submenu that converts the block to a numbered list item",
  },
  turnIntoChecklist: {
    id: "codex.space.page.controls.turnInto.checklist",
    defaultMessage: "Checklist",
    description: "Option in the Page block Turn into submenu that converts the block to an unchecked checklist item",
  },
  turnIntoQuote: {
    id: "codex.space.page.controls.turnInto.quote",
    defaultMessage: "Quote",
    description: "Option in the Page block Turn into submenu that converts the block to a block quote",
  },
  turnIntoHighlight: {
    id: "codex.space.page.controls.turnInto.highlight",
    defaultMessage: "Highlight",
    description: "Option in the Page block Turn into submenu that converts the block into a shaded callout with an optional emoji",
  },
  turnIntoCode: {
    id: "codex.space.page.controls.turnInto.code",
    defaultMessage: "Code",
    description: "Option in the Page block Turn into submenu that converts the block to a plain-text code block",
  },
  tableOptions: {
    id: "codex.space.page.controls.tableOptions",
    defaultMessage: "Table options",
    description: "Opens table-wide layout and content actions for this Page table",
  },
  labeledRowOptions: {
    id: "codex.space.page.controls.labeledRowOptions",
    defaultMessage: "Row {label} options",
    description: "Accessible label for a Page table row's menu button; label is the displayed row number, such as 2",
  },
  labeledColumnOptions: {
    id: "codex.space.page.controls.labeledColumnOptions",
    defaultMessage: "Column {label} options",
    description: "Accessible label for a Page table column's menu button; label is the displayed column letter, such as B",
  },
  sectionDragHint: {
    id: "codex.space.page.controls.sectionDragHint",
    defaultMessage: "Drag to move section",
    description: "Tooltip for a heading grip; dragging moves the heading and its content up to but not including the next heading of equal or higher rank",
  },
  listDragHint: {
    id: "codex.space.page.controls.listDragHint",
    defaultMessage: "Drag to move list",
    description: "Tooltip for the list grip while Option or Alt is held, when dragging moves the whole containing list",
  },
  dragHint: {
    id: "codex.space.page.controls.dragHint",
    defaultMessage: "Drag to move · Click for options",
    description: "Tooltip for a Page block or checklist item grip that can be dragged to reorder or clicked to open options",
  },
  insertBelow: {
    id: "codex.space.page.controls.insertBelow",
    defaultMessage: "Insert below",
    description: "Insert a new paragraph directly after this Page block and start editing it",
  },
  copyLink: {
    id: "codex.space.page.controls.copyLink",
    defaultMessage: "Copy link",
    description: "Copy a link to this saved Page block",
  },
  deleteTable: {
    id: "codex.space.page.controls.deleteTable",
    defaultMessage: "Delete table",
    description: "Delete this entire Page table",
  },
  deleteBlock: {
    id: "codex.space.page.controls.deleteBlock",
    defaultMessage: "Delete",
    description: "Delete this entire Page content block",
  },
  deleteListRow: {
    id: "codex.space.page.controls.deleteListRow",
    defaultMessage: "Delete row",
    description: "Delete the hovered list row and its descendants",
  },
  deleteList: {
    id: "codex.space.page.controls.deleteList",
    defaultMessage: "Delete list",
    description: "Delete the whole outer containing list while Option or Alt is held",
  },
  row: {
    id: "codex.space.page.controls.row",
    defaultMessage: "Row options",
    description: "Actions for one Page table row",
  },
  column: {
    id: "codex.space.page.controls.column",
    defaultMessage: "Column options",
    description: "Actions for one Page table column",
  },
  insertRowAbove: {
    id: "codex.space.page.controls.insertRowAbove",
    defaultMessage: "Insert row above",
    description: "Insert a table row above the targeted row",
  },
  insertRowBelow: {
    id: "codex.space.page.controls.insertRowBelow",
    defaultMessage: "Insert row below",
    description: "Insert a table row below the targeted row",
  },
  deleteRow: {
    id: "codex.space.page.controls.deleteRow",
    defaultMessage: "Delete row",
    description: "Delete the targeted table row",
  },
  moveRowUp: {
    id: "codex.space.page.controls.moveRowUp",
    defaultMessage: "Move row up",
    description: "Move the targeted table row one position up",
  },
  moveRowDown: {
    id: "codex.space.page.controls.moveRowDown",
    defaultMessage: "Move row down",
    description: "Move the targeted table row one position down",
  },
  moveColumnLeft: {
    id: "codex.space.page.controls.moveColumnLeft",
    defaultMessage: "Move column left",
    description: "Move the targeted table column one position to the left",
  },
  moveColumnRight: {
    id: "codex.space.page.controls.moveColumnRight",
    defaultMessage: "Move column right",
    description: "Move the targeted table column one position to the right",
  },
  insertColumnLeft: {
    id: "codex.space.page.controls.insertColumnLeft",
    defaultMessage: "Insert column left",
    description: "Insert a table column before the targeted column",
  },
  insertColumnRight: {
    id: "codex.space.page.controls.insertColumnRight",
    defaultMessage: "Insert column right",
    description: "Insert a table column after the targeted column",
  },
  deleteColumn: {
    id: "codex.space.page.controls.deleteColumn",
    defaultMessage: "Delete column",
    description: "Delete the targeted table column",
  },
  layoutMenuTitle: {
    id: "codex.space.page.block.layout.menuTitle",
    defaultMessage: "Width",
    description: "Submenu with width and alignment choices that apply to one whole Page block",
  },
  layoutReading: {
    id: "codex.space.page.block.layout.reading",
    defaultMessage: "Normal",
    description: "Block layout that stays inside the normal reading column",
  },
  layoutWideAligned: {
    id: "codex.space.page.block.layout.wideAligned",
    defaultMessage: "Flexible",
    description: "Block layout that starts at the reading column and can scroll into its margins",
  },
  layoutWideCentered: {
    id: "codex.space.page.block.layout.wideCentered",
    defaultMessage: "Full width",
    description: "Block layout centered across the available page width",
  },
});

export const tableMessages = defineMessages({
  fitMenuTitle: {
    id: "codex.space.page.table.fitMenuTitle",
    defaultMessage: "Fit",
    description: "Table submenu with actions to fit column widths to the normal page width or optimize them for readability",
  },
  fitToContentWidth: {
    id: "codex.space.page.table.fitToContentWidth",
    defaultMessage: "Normal width",
    description:
      "Action in the Fit submenu: resize the whole table to the Normal width option in the Width menu, balancing column widths for their contents without shrinking below the minimum width the contents need",
  },
  fitForReadability: {
    id: "codex.space.page.table.fitForReadability",
    defaultMessage: "For readability",
    description: "Action in the Fit submenu: size table columns for comfortable reading, allowing the table to expand to twice the normal content width",
  },
  distributeColumns: {
    id: "codex.space.page.table.distributeColumns",
    defaultMessage: "Distribute columns evenly",
    description: "Make every column in this table the same width while preserving the total table width",
  },
  controls: {
    id: "codex.space.page.table.controls",
    defaultMessage: "Table controls",
    description: "Accessible label for the editing controls of a Page table",
  },
  resizeRowNumber: {
    id: "codex.space.page.table.resizeRowNumber",
    defaultMessage: "Resize row {row}",
    description: "Accessible name for the divider that resizes the numbered table row",
  },
  resizeColumnLetter: {
    id: "codex.space.page.table.resizeColumnLetter",
    defaultMessage: "Resize column {column}",
    description: "Accessible name for the divider that resizes the lettered table column",
  },
  appendRow: {
    id: "codex.space.page.table.appendRow",
    defaultMessage: "Add row",
    description: "Append a row at the bottom edge of the table",
  },
  addColumnLeft: {
    id: "codex.space.page.table.addColumnLeft",
    defaultMessage: "Add column on the left",
    description: "Add a column at the physical left edge of the table",
  },
  addColumnRight: {
    id: "codex.space.page.table.addColumnRight",
    defaultMessage: "Add column on the right",
    description: "Add a column at the physical right edge of the table",
  },
  toolbarDelete: {
    id: "codex.space.page.table.toolbar.delete",
    defaultMessage: "Delete table",
    description: "Delete the entire table from the Page",
  },
  resizeColumn: {
    id: "codex.page.table.resizeColumn",
    defaultMessage: "Resize column",
    description: "Accessible label for a table column boundary. Drag or use arrow keys to change its width.",
  },
});

export const pageLinkMessages = defineMessages({
  unavailable: {
    id: "codex.space.page.linkPrivate",
    defaultMessage: "Unavailable page",
    description: "Replacement text for a linked Page that is unavailable to the current viewer, without revealing its title or why it is unavailable",
  },
  dialogTitle: {
    id: "codex.space.page.linkDialog.title",
    defaultMessage: "Link to page",
    description: "Title of the dialog for choosing another accessible shared Page to link from the current Page",
  },
  searchLabel: {
    id: "codex.space.page.linkDialog.searchLabel",
    defaultMessage: "Search accessible pages",
    description: "Accessible label for the search field in the shared Page link picker",
  },
  searchPlaceholder: {
    id: "codex.space.page.linkDialog.searchPlaceholder",
    defaultMessage: "Search pages…",
    description: "Placeholder in the search field used to find an accessible shared Page to link",
  },
  noMatchingPages: {
    id: "codex.space.page.linkDialog.noMatchingPages",
    defaultMessage: "No matching pages",
    description: "Shown when the Page link dialog has searched all available results and found no matching Pages",
  },
  createSubpage: {
    id: "codex.space.page.linkDialog.createSubpage",
    defaultMessage: "Create subpage",
    description: "Button in the shared Page link picker that creates a child Page underneath the current Page and inserts a link to the new child",
  },
});

export const outlineMessages = defineMessages({
  ariaLabel: {
    id: "codex.space.page.tableOfContents.ariaLabel",
    defaultMessage: "Page contents",
    description: "Aria label for the floating Page navigation rail that jumps between headings in a shared Page",
  },
  jumpAriaLabel: {
    id: "codex.space.page.tableOfContents.jumpAriaLabel",
    defaultMessage: "Jump to heading {position}: {title}",
    description: "Accessible label for a marker in the floating shared Page table of contents",
  },
});

export const slashMenuMessages = defineMessages({
  label: {
    id: "codex.space.page.slashMenu.label",
    defaultMessage: "Insert options",
    description: "Accessible label for a shared Page slash menu containing formatting options and a command to create a nested child Page",
  },
  generateQuery: {
    id: "codex.space.page.slashMenu.generateQuery",
    defaultMessage: "Generate — {query}",
    description: "Slash-menu action to generate text from the complete typed query",
  },
  canvasQuery: {
    id: "codex.space.page.slashMenu.canvasQuery",
    defaultMessage: "Canvas — {query}",
    description: "Slash-menu action to create a canvas from the instruction after its command",
  },
  visualizeQuery: {
    id: "codex.space.page.slashMenu.visualizeQuery",
    defaultMessage: "Visualize — {query}",
    description: "Slash-menu action to create an interactive visualization from the instruction after its command",
  },
});

export const attributionMessages = defineMessages({
  footerDotOwnerProductName: {
    id: "codex.space.page.blockAttribution.footer.dotOwner.productName",
    defaultMessage: "Last edited by {hasOwner, select, true {{name}’s {dot}} other {a {dot}}}",
    description: "Block menu footer identifying a bot, an always-on agent, as the last editor. Name is the responsible person's first name, never the agent's private nickname. bot is a common noun for the agent and must remain untranslated.",
  },
  footerAuthorizedAgent: {
    id: "codex.space.page.blockAttribution.footer.authorizedAgent",
    defaultMessage: "Last edited by Willow, authorized by {name}",
    description: "Block menu footer identifying ChatGPT as the last editor and the named user as its authorizer, not its direct editor",
  },
  footerPerson: {
    id: "codex.space.page.blockAttribution.footer.person",
    defaultMessage: "Last edited by {name}",
    description: "Block menu footer identifying the last editor of the selected Page block",
  },
  footerActor: {
    id: "codex.space.page.blockAttribution.footer.actor",
    defaultMessage: "{type, select, agent {Last edited by Willow} system {Last edited by System} user {Last edited by a collaborator} other {Last edited by another contributor}}",
    description: "Block menu footer identifying the last editor when no personal display name is available",
  },
  loading: {
    id: "codex.space.page.blockAttribution.loading",
    defaultMessage: "Loading…",
    description: "Screen reader status in the Page attribution rail while the names of the document's editors load",
  },
  authorizedAgent: {
    id: "codex.space.page.blockAttribution.authorizedAgent",
    defaultMessage: "Willow, authorized by {name}",
    description: "Attribution for a Page block edited by ChatGPT acting with permission from the named account user; name identifies the authorizing user, not the direct editor",
  },
  actor: {
    id: "codex.space.page.blockAttribution.actor",
    defaultMessage: "{type, select, agent {Willow} system {System} user {A collaborator} other {Another contributor}}",
    description: "Name shown in a shared Page block's left-gutter attribution when the editor is ChatGPT, system, a user without a visible display name, or another actor",
  },
  tooltipDotProductName: {
    id: "codex.space.page.blockAttribution.tooltip.dot.productName",
    defaultMessage: "{hasOwner, select, true {{name}’s {dot}} other {A {dot}}} · {date}",
    description: "Tooltip identifying a bot, an always-on agent, as a Page block's last editor and showing the edit date. Name is the responsible person's first name, never the agent's private nickname. bot is a common noun for the agent and must remain untranslated.",
  },
  tooltip: {
    id: "codex.space.page.blockAttribution.tooltip",
    defaultMessage: "{name} · {date}",
    description: "Tooltip on a shared Page document's left-gutter block attribution; name identifies the last editor and date is their edit time",
  },
  agentName: {
    id: "codex.space.page.blockAttribution.agentName",
    defaultMessage: "Willow",
    description: "Compact name in the Page attribution column for ChatGPT; its authorizing user is identified in the tooltip and block menu",
  },
});

export const mentionMessages = defineMessages({
  working: {
    id: "codex.page.taskMention.working",
    defaultMessage: "Working…",
    description: "Status below a Page comment while its mentioned ChatGPT task is starting or working",
  },
  needsApproval: {
    id: "codex.page.taskMention.needsApproval",
    defaultMessage: "Needs approval",
    description: "Button below a Page comment: its mentioned ChatGPT task is waiting for approval. Opens the task so its owner can review the request.",
  },
  needsInput: {
    id: "codex.page.taskMention.needsInput",
    defaultMessage: "Needs input",
    description: "Button below a Page comment: its mentioned ChatGPT task is waiting for an answer. Opens the task so its owner can respond.",
  },
  stop: {
    id: "codex.page.taskMention.stop",
    defaultMessage: "Pause task",
    description: "Stop the task owned by this Page mention",
  },
  start: {
    id: "codex.page.taskMention.start",
    defaultMessage: "Start task",
    description: "Resume the task owned by this Page mention",
  },
  open: {
    id: "codex.page.taskMention.open",
    defaultMessage: "Open task",
    description: "Action in a ChatGPT mention toolbar that opens the owner's task",
  },
  controlError: {
    id: "codex.page.taskMention.controlError",
    defaultMessage: "Could not update task",
    description: "Failure starting or stopping a Page mention task",
  },
  dotSendRetryPrivateProductName: {
    id: "codex.page.taskMention.dotSendRetryPrivate.productName",
    defaultMessage: "Message could not be sent to your {dot}. Edit and retry",
    description: "Owner-only action beside a Page mention to retry sending to the user's agent. bot is a common noun for the agent and must remain untranslated.",
  },
  retry: {
    id: "codex.page.taskMention.retry",
    defaultMessage: "Task could not start. Edit and retry",
    description: "Action beside a Page or comment mention that reopens the request after task startup failed",
  },
  checkTask: {
    id: "codex.page.taskMention.checkTask",
    defaultMessage: "Task could not start. Open task",
    description: "Action beside a Page or comment mention that opens its existing task to inspect failed or uncertain startup",
  },
  orbitRequestSource: {
    id: "codex.page.taskMention.orbitRequestSource",
    defaultMessage: "From [Page]({pageUrl})",
    description: "Source label for a Page comment task request. Keep the Markdown link syntax intact.",
  },
  commentStartError: {
    id: "codex.page.taskMention.commentStartError",
    defaultMessage: "Could not start this task. Your comment has been kept.",
    description: "Failure starting a task from a saved Page comment",
  },
  dotSendErrorProductName: {
    id: "codex.page.taskMention.dotSendError.productName",
    defaultMessage: "Could not send to your {dot}. Your comment has been kept",
    description: "Owner-only failure delivering a saved Page comment request to the user's agent. bot is a common noun for the agent and must remain untranslated.",
  },
  prompt: {
    id: "codex.page.taskMention.prompt",
    defaultMessage: "What should Willow do?",
    description: "Prompt for a task started from a ChatGPT mention in a Page or comment",
  },
  deleteTitle: {
    id: "codex.page.taskMention.deleteTitle",
    defaultMessage: "Remove Willow mention?",
    description: "Confirmation before the owner removes a task mention from a Page",
  },
  deleteDescription: {
    id: "codex.page.taskMention.deleteDescription",
    defaultMessage: "Stop the linked task, or let it keep working after removing the mention",
    description: "Deleting a Page or comment mention can stop or detach the owner's task",
  },
  deleteError: {
    id: "codex.page.taskMention.deleteError",
    defaultMessage: "Could not remove the mention. It has been kept.",
    description: "Failure or concurrent edit while confirming task mention deletion",
  },
  cancel: {
    id: "codex.page.taskMention.cancel",
    defaultMessage: "Cancel",
    description: "Keep the Page mention and task unchanged",
  },
  keepWorking: {
    id: "codex.page.taskMention.keepWorking",
    defaultMessage: "Keep working",
    description: "Remove the mention and leave the task running",
  },
  stopAndRemove: {
    id: "codex.page.taskMention.stopAndRemove",
    defaultMessage: "Stop and remove",
    description: "Stop the task and remove its mention from the Page",
  },
  orbitVisibleResolution: {
    id: "codex.page.taskMention.orbitVisibleResolution",
    defaultMessage: "Resolved a comment on [Page]({pageUrl})",
    description: "Notification sent to the bot when the user resolves its Page comment. Keep the Markdown link syntax intact.",
  },
  dotCommentSendErrorProductName: {
    id: "codex.page.taskMention.dotCommentSendError.productName",
    defaultMessage: "Could not send this update to your {dot}",
    description: "Toast when saving or sending a Page reply or resolution notice to the user's agent fails. bot is a common noun for the agent and must remain untranslated.",
  },
  orbitCommentSendRetry: {
    id: "codex.page.taskMention.orbitCommentSendRetry",
    defaultMessage: "Retry",
    description: "Retry sending a saved Page comment to the user's bot assistant",
  },
  selfLabel: {
    id: "codex.page.taskMention.selfLabel",
    defaultMessage: "@Willow",
    description: "ChatGPT task mention shown to its owner or when the owner’s name is unavailable; keep the product name",
  },
  ownerLabel: {
    id: "codex.page.taskMention.ownerLabel",
    defaultMessage: "@{name}’s Willow",
    description: "ChatGPT task mention shown to someone other than its owner, using the owner's first name",
  },
  taskMentionDetail: {
    id: "codex.space.page.taskMention.mentionDetail",
    defaultMessage: "Start a task",
    description: "Description of the ChatGPT action that opens a composer for a task in a Page",
  },
  taskMentionLabel: {
    id: "codex.space.page.taskMention.mentionLabel",
    defaultMessage: "Willow",
    description: "ChatGPT product name in a Page's mention menu, used to start a task",
  },
  orbitMentionDetail: {
    id: "codex.space.page.orbitMention.mentionDetailWithDefault",
    defaultMessage: "{isDefault, select, true {Send to your dot} other {Send to {name}}}",
    description: "Description of the Page mention action that sends a request to the user's personal assistant. Name is the assistant's saved nickname; isDefault uses the term bot instead. Keep the singular term bot untranslated.",
  },
  orbitMentionDetailRich: {
    id: "codex.space.page.orbitMention.mentionDetailRichWithDefault",
    defaultMessage: "{isDefault, select, true {Send to your <b>bot</b>} other {Send to <b>{name}</b>}}",
    description: "Description of the Page mention action that sends a request to the user's personal assistant. The assistant's saved nickname, or the term bot when isDefault is true, is bold. Keep the singular term bot untranslated.",
  },
  dotOwnerLabel: {
    id: "codex.page.dot.ownerLabel.productName",
    defaultMessage: "{mention, select, true {@} other {}}{hasOwner, select, true {{name}’s {dot}} other {{dot}}}",
    description: "Shared Page label for a bot, an always-on agent, using the responsible person's first name when known. bot is a common noun for the agent and must remain untranslated. Mention labels start with @. Never use the agent's private nickname.",
  },
});

export const formatMessages = defineMessages({
  editLinkPreview: {
    id: "codex.space.page.format.editLinkPreview",
    defaultMessage: "Edit",
    description: "Button in a Page link hover preview that opens editing of the link text and destination",
  },
  editExistingLink: {
    id: "codex.space.page.format.editExistingLink",
    defaultMessage: "Edit link",
    description: "Label, tooltip, and accessible name for the floating Page toolbar button that edits the hyperlink at the current text cursor in Codex Apps.",
  },
  removeLink: {
    id: "codex.space.page.format.removeLink",
    defaultMessage: "Remove link",
    description: "Tooltip and accessible name for the floating Page toolbar button that removes hyperlink formatting while keeping the text at the current cursor in Codex Apps.",
  },
  copyLink: {
    id: "codex.space.page.format.copyLink",
    defaultMessage: "Copy link",
    description: "Tooltip and accessible name for the floating Page toolbar button that copies the URL of the hyperlink at the current text cursor in Codex Apps.",
  },
  copyEmailAddress: {
    id: "codex.space.page.format.copyEmailAddress",
    defaultMessage: "Copy email address",
    description: "Tooltip and accessible name for the Page link action that copies only the email address, without the mailto prefix or message options.",
  },
  linkCopied: {
    id: "codex.space.page.format.linkCopied",
    defaultMessage: "Copied",
    description: "Temporary tooltip and accessible name confirming that the Page link URL or email address was successfully copied to the clipboard.",
  },
  openLink: {
    id: "codex.space.page.format.openLink",
    defaultMessage: "Open link",
    description: "Tooltip and accessible name for the floating Page toolbar button that safely opens the hyperlink at the current text cursor in Codex Apps.",
  },
  linkField: {
    id: "codex.space.page.format.linkField",
    defaultMessage: "URL or Page",
    description: "Label for the destination field when adding or editing a link in a Page",
  },
  linkInput: {
    id: "codex.space.page.format.linkInput",
    defaultMessage: "Link URL or page",
    description: "Accessible name for the input used to search Pages or enter a URL when adding a link in a Codex Apps Page.",
  },
  linkPlaceholder: {
    id: "codex.space.page.format.linkPlaceholder",
    defaultMessage: "Paste a link or search pages…",
    description: "Placeholder in the input used to search Pages or enter a URL when adding a link in a Codex Apps Page.",
  },
  searchingPages: {
    id: "codex.space.page.format.searchingPages",
    defaultMessage: "Searching pages",
    description: "Accessible loading label while the Page link picker searches Pages in the current Space.",
  },
  linkTitle: {
    id: "codex.space.page.format.linkTitle",
    defaultMessage: "Title",
    description: "Label for the editable display text of a hyperlink in a Page",
  },
  linkTitleInput: {
    id: "codex.space.page.format.linkTitleInput",
    defaultMessage: "Link title",
    description: "Accessible name for the display text input in the Page link editor",
  },
  noMatchingPages: {
    id: "willow.pages.format.noMatchingPages",
    defaultMessage: "No matching pages",
    description: "Empty state when the inline Page link picker finds no Pages",
  },
  removeExistingLink: {
    id: "codex.space.page.format.removeExistingLink",
    defaultMessage: "Remove link",
    description: "Button in the Page link editor that removes the hyperlink while keeping its text",
  },
  cancelLink: {
    id: "codex.space.page.format.cancelLink",
    defaultMessage: "Cancel",
    description: "Discards an unsaved link destination edit and returns to the Page",
  },
  saveLink: {
    id: "codex.space.page.format.saveLink",
    defaultMessage: "Save",
    description: "Saves the link destination or its edited display title",
  },
  textStyles: {
    id: "codex.space.page.format.textStyles",
    defaultMessage: "Text styles",
    description: "Accessible name for the floating Page formatting menu in Codex Apps that offers paragraph, heading, list, checklist, quote, and code block styles.",
  },
  textStyleChecklist: {
    id: "codex.space.page.format.textStyle.checklist",
    defaultMessage: "Checklist",
    description: "Page formatting-menu option in Codex Apps that converts the selected text into an unchecked checklist.",
  },
  textStyleHeading1: {
    id: "codex.space.page.format.textStyle.heading1",
    defaultMessage: "Heading 1",
    description: "Page formatting-menu option in Codex Apps that converts the selected text into a level-one heading.",
  },
  textStyleHeading2: {
    id: "codex.space.page.format.textStyle.heading2",
    defaultMessage: "Heading 2",
    description: "Page formatting-menu option in Codex Apps that converts the selected text into a level-two heading.",
  },
  textStyleHeading3: {
    id: "codex.space.page.format.textStyle.heading3",
    defaultMessage: "Heading 3",
    description: "Page formatting-menu option in Codex Apps that converts the selected text into a level-three heading.",
  },
  textStyleNumberedList: {
    id: "codex.space.page.format.textStyle.numberedList",
    defaultMessage: "Numbered list",
    description: "Page formatting-menu option in Codex Apps that converts the selected text into a numbered list.",
  },
  textStyleText: {
    id: "codex.space.page.format.textStyle.text",
    defaultMessage: "Text",
    description: "Page formatting-menu option in Codex Apps that converts the selected text into an ordinary paragraph.",
  },
  textStyleBulletedList: {
    id: "codex.space.page.format.textStyle.bulletedList",
    defaultMessage: "Bulleted list",
    description: "Page formatting-menu option in Codex Apps that converts the selected text into a bulleted list.",
  },
  textStyleQuote: {
    id: "codex.space.page.format.textStyle.quote",
    defaultMessage: "Quote",
    description: "Page formatting-menu option in Codex Apps that wraps the selected blocks in a block quote.",
  },
  textStyleCodeBlock: {
    id: "codex.space.page.format.textStyle.codeBlock",
    defaultMessage: "Code",
    description: "Page formatting-menu option in Codex Apps that converts the selected text into a code block.",
  },
  bold: {
    id: "codex.space.page.format.bold",
    defaultMessage: "Bold",
    description: "Accessible name for the floating Page toolbar button that toggles bold formatting on selected text in Codex Apps.",
  },
  code: {
    id: "codex.space.page.format.code",
    defaultMessage: "Code",
    description: "Accessible name for the floating Page toolbar button that toggles inline code formatting on selected text in Codex Apps.",
  },
  italic: {
    id: "codex.space.page.format.italic",
    defaultMessage: "Italic",
    description: "Accessible name for the floating Page toolbar button that toggles italic formatting on selected text in Codex Apps.",
  },
  underline: {
    id: "codex.space.page.format.underline",
    defaultMessage: "Underline",
    description: "Accessible name for the floating Page toolbar button that toggles underline formatting on selected text in Codex Apps.",
  },
  strikethrough: {
    id: "codex.space.page.format.strikethrough",
    defaultMessage: "Strikethrough",
    description: "Accessible name for the floating Page toolbar button that toggles strikethrough formatting on selected text in Codex Apps.",
  },
  link: {
    id: "codex.space.page.format.link",
    defaultMessage: "Link",
    description: "Accessible name for the floating Page toolbar button that adds or removes a hyperlink on selected text in Codex Apps.",
  },
  boldAbbreviation: {
    id: "codex.space.page.format.boldAbbreviation",
    defaultMessage: "B",
    description: "Single-letter visual abbreviation on the bold-formatting button in a Codex Apps Page toolbar. It should represent bold formatting in the target language.",
  },
  underlineAbbreviation: {
    id: "codex.space.page.format.underlineAbbreviation",
    defaultMessage: "U",
    description: "Single-letter visual abbreviation on the underline-formatting button in a Codex Apps Page toolbar. It should represent underline formatting in the target language.",
  },
  strikethroughAbbreviation: {
    id: "codex.space.page.format.strikethroughAbbreviation",
    defaultMessage: "S",
    description: "Single-letter visual abbreviation on the strikethrough-formatting button in a Codex Apps Page toolbar. It should represent strikethrough formatting in the target language.",
  },
  editing: {
    id: "codex.space.page.format.editing",
    defaultMessage: "Editing…",
    description: "Status while ChatGPT generates a suggested edit for selected Page text, before the user accepts any changes.",
  },
  submitEdit: {
    id: "codex.space.page.format.submitEdit",
    defaultMessage: "Submit edit instruction",
    description: "Accessible name for the button that submits an AI edit instruction for selected text in a Codex Apps Page.",
  },
  editInput: {
    id: "codex.space.page.format.editInput",
    defaultMessage: "Edit instruction",
    description: "Accessible name for the AI edit instruction input shown when editing selected text in a Codex Apps Page.",
  },
  editPlaceholder: {
    id: "codex.space.page.format.editPlaceholder",
    defaultMessage: "Describe the edit…",
    description: "Placeholder in the AI edit instruction input shown when editing selected text in a Codex Apps Page.",
  },
});

/** `TN` */
export const linkMessages = defineMessages({
  field: {
    id: "codex.space.page.format.linkField",
    defaultMessage: "URL or Page",
    description: "Label for the destination field when adding or editing a link in a Page",
  },
  input: {
    id: "codex.space.page.format.linkInput",
    defaultMessage: "Link URL or page",
    description: "Accessible name for the input used to search Pages or enter a URL when adding a link in a Codex Apps Page.",
  },
  placeholder: {
    id: "codex.space.page.format.linkPlaceholder",
    defaultMessage: "Paste a link or search pages…",
    description: "Placeholder in the input used to search Pages or enter a URL when adding a link in a Codex Apps Page.",
  },
  title: {
    id: "codex.space.page.format.linkTitle",
    defaultMessage: "Title",
    description: "Label for the editable display text of a hyperlink in a Page",
  },
  titleInput: {
    id: "codex.space.page.format.linkTitleInput",
    defaultMessage: "Link title",
    description: "Accessible name for the display text input in the Page link editor",
  },
  remove: {
    id: "codex.space.page.format.removeExistingLink",
    defaultMessage: "Remove link",
    description: "Button in the Page link editor that removes the hyperlink while keeping its text",
  },
  cancel: {
    id: "codex.space.page.format.cancelLink",
    defaultMessage: "Cancel",
    description: "Discards an unsaved link destination edit and returns to the Page",
  },
  save: {
    id: "codex.space.page.format.saveLink",
    defaultMessage: "Save",
    description: "Saves the link destination or its edited display title",
  },
});

export const promptBlockMessages = defineMessages({
  sendLabel: {
    id: "codex.space.page.prompt.sendLabel",
    defaultMessage: "Send to chat: {prompt}",
    description: "Accessible label for a Page Prompt block's send button, including the prompt that will be sent",
  },
  editEmpty: {
    id: "codex.space.page.prompt.editEmpty",
    defaultMessage: "Edit prompt",
    description: "Accessible label for focusing an empty Page Prompt block to write a prompt",
  },
  sendOrEdit: {
    id: "codex.space.page.prompt.sendOrEdit",
    defaultMessage: "Send to chat • {modifier}+click to edit",
    description: "Hover hint for a Page Prompt block. Clicking sends the prompt to a new chat; holding the indicated keyboard modifier while clicking selects all its text for editing. The modifier is ⌘ on Mac or Ctrl on Windows and Linux.",
  },
  send: {
    id: "codex.space.page.prompt.send",
    defaultMessage: "Send to chat",
    description: "Hover hint for starting a new chat on the current Page using a Prompt block's text",
  },
  failed: {
    id: "codex.space.page.prompt.failed",
    defaultMessage: "Couldn’t start a chat. Try again",
    description: "Shown when a reader clicks a Page Prompt block but its new page chat cannot be started",
  },
  placeholder: {
    id: "codex.space.page.prompt.placeholder",
    defaultMessage: "Type a prompt that readers can use to start a chat",
    description: "Placeholder in a newly inserted Page Prompt block; its text becomes the first message when a reader starts a chat",
  },
});

export const taskBlockMessages = defineMessages({
  label: {
    id: "codex.space.page.task.label",
    defaultMessage: "Task",
    description: "Heading of a Page block containing an editable prompt that can launch a Codex task",
  },
  preview: {
    id: "codex.space.page.task.preview",
    defaultMessage: "Preview",
    description: "Show the task prompt with labeled links instead of editable Markdown",
  },
  edit: {
    id: "codex.space.page.task.edit",
    defaultMessage: "Edit",
    description: "Edit the task prompt including its full Markdown links",
  },
  start: {
    id: "codex.space.page.task.start",
    defaultMessage: "Run task",
    description: "Run a Codex task using this Page block's prompt after the user has reviewed it",
  },
  open: {
    id: "codex.space.page.task.open",
    defaultMessage: "Open chat",
    description: "Open the chat containing the Codex task linked to this Page action item",
  },
  failed: {
    id: "codex.space.page.task.failed",
    defaultMessage: "Couldn’t start this task. Check that the page is saved and try again.",
    description: "Shown when a Page action item could not be saved or its task could not be created",
  },
  startUnconfirmed: {
    id: "codex.space.page.task.startUnconfirmed",
    defaultMessage: "Couldn’t confirm the task started. Open chat to check before trying again.",
    description: "A task link was saved but submission failed or its outcome is unknown; the user should inspect the existing task to avoid duplicate work",
  },
});
