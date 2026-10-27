# Subtitle Editor

## Layout

The editor is in the **Subtitles** tab of the detail view. Each row of the table is an utterance with the columns **#**, **Start**, **End**, **Speaker** and **Text**. On narrow screens the column headings and the **#** column are not shown.

![The detail view with the player, the search, the version buttons and the first rows of the editor; numbered markers highlight the controls](shots/editor.png)

1. The player (see "Playing and following along").
2. The search field **Search subtitles...** with the buttons **Text** and **Speaker** (see "Searching").
3. **Original**, **Refined** and **Translated** switch between the original and its refined and translated versions (see "Refined and translated view").
4. A row is one utterance. Its pencil icons edit the times, the speaker and the text (see the sections below).
5. The row's **Speaker**. The colored dot shows who is speaking; the same name always has the same color.

## Editing text

Click the pencil icon after the text and start typing. Clicking outside the field applies the change. **Tab** applies it and jumps to the text of the next row, **Shift+Tab** to the previous one. The player then jumps to the start of that row. **Esc** ends editing; the change is kept.

On larger screens the **Keyboard shortcuts** list above the table lists these three keys.

Your changes only exist in your browser until you save them (see "Saving").

## Editing times

Use the pencil icon next to **Start** or **End** to change a time. The table shows whole seconds, the field shows the time with milliseconds, for example `00:01:30.500`. You can also enter only minutes and seconds (`01:30`) or only seconds (`90`). A fraction of a second follows a point or a comma, for example `12,5`. Press Enter or click outside the field to apply the time. If the time is unchanged or not a valid time, the row stays as it was.

If the new time overlaps neighboring rows, the editor adjusts them: a new start shortens the end of the previous rows, a new end moves the start of the following rows. Before that, a prompt tells you how many rows are affected. If you cancel it, nothing changes. If the new start is after the end of the row, the end moves along. Likewise the start moves back if the new end is before it.

## A row's speaker

In the **Speaker** column, the pencil icon changes the name on this row only, the people icon renames the person on all rows. Both are described in the section "Speaker Mapping".

## Inserting, merging and deleting rows

More icons appear in the text field of the row:

- **Merge with next section** joins the text with the text of the next row and takes over its end. The last row has no such icon.
- **Add new row after this one** creates an empty row below with the same speaker. It starts at the end of the current row and ends at the start of the next one, or one second later for the last row. On larger screens this icon appears in the **#** column instead.
- **Delete this row** removes the row once you confirm the prompt.

## Searching

The **Search subtitles...** field above the table searches the rows, ignoring upper and lower case. The **Text** and **Speaker** buttons choose where to search. Both are active at first. Click one and only the other stays active. Click the active one and both are active again.

Matches are highlighted. The rows before and after stay visible as dimmed context. Each gap of hidden rows is summarized by a separator row, for example **3 segments hidden**. Next to the field you see how many segments match, for example **2 of 40 segments**. Without matches, **No matching segments** appears. Press **Esc** in the search field or click the cross in the field to clear the search.

## Playing and following along

Clicking **Start**, **Speaker** or **Text** of a row jumps the player to the start of the utterance, clicking **End** jumps to its end. If the player is paused, it starts playing. While it plays, the current row is highlighted and the table scrolls along. Scrolling along pauses while a search is active.

Below the player, **Download recording** downloads the recording. For videos, **Minimize player** hides the picture and **Show video** brings it back. For videos, the player also contains, while it is not minimized, a subtitle track with the original text and the speaker names, including unsaved changes. It is switched off at first.

## Saving

As soon as you change something, the buttons **Save changes** and **Restore original** appear above the table. Saving replaces the previously saved version on the server. After a prompt, **Restore original** discards all changes since the last save and reloads the saved version. transkribierBAR does not keep an earlier version after you save.

If you switch to a format tab such as **SRT**, your changes are kept, and the format already shows them.

> **Save before you leave.** If you leave the detail view with unsaved changes, transkribierBAR asks first. Closing or reloading the browser tab also triggers a browser warning. If you confirm, the unsaved changes stay in this tab only until you open another transcription, start a new upload or recording, or reload or close the tab. Until then, **Forward** in the browser brings you back to them. Save first.

## Refined and translated view

If the AI features are set up on this server, the editor offers the buttons **Refine with LLM** and **Translate** above the table as long as there is no refinement or translation yet. A refinement and a translation appear next to the original. Use the buttons **Original**, **Refined** and **Translated** to switch between them. The **Refined** and **Translated** views are read-only: the editing icons are missing there, and changes only apply to the original. **Delete Refinement** and **Delete translation** remove the respective version after a prompt.

In the **Refined** view, **Changes Summary** says what the language model changed. Changed rows have a **Compare** button next to the text, on every screen size. It shows the original and the refined text side by side below the row; click it again to close the comparison. On larger screens, changed rows also carry a dot next to the row number. How both functions work is described in the sections "Refinement" and "Translation".
