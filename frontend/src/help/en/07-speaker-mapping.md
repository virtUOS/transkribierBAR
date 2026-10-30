# Speaker Mapping

## Opening the panel

In the **Subtitles** tab, open the **Speaker Names** panel: with the button of the same name above the table or with the people icon in the **Speaker** column of a row.

![The Speaker Names panel above the editor table; numbered markers highlight the controls](shots/speakers.png)

1. **Speaker Names** opens the panel. Another click closes it again.
2. The field for a new name (**New name (leave empty to keep)**), to the right of the name currently shown (see "Naming speakers").
3. **Apply** saves the names (see "How the names are saved").
4. The **Speaker** column of a row. Its people icon (**Rename speaker in all utterances**) opens the panel and places the cursor straight in the field for that person. Its pencil icon changes only this row (see "Changing a single row").

In the **Refined** and **Translated** views the people icon is missing, but the button works.

If the recording has no detected speakers, the panel shows **No speakers detected.** You decide whether speakers are detected before the transcription (see "Transcription Settings").

## Naming speakers

The panel lists each speaker with the name that is currently shown. Without a name of your own, that is the stored label, for example `SPEAKER_00`. Enter a new name in the field to its right and click **Apply**. Fields you leave empty (**New name (leave empty to keep)**) keep their name. transkribierBAR removes spaces at the start and end of the name. **Cancel** closes the panel without any change.

The new name then appears in the table, for videos in the player's subtitle track and in the **SRT**, **VTT**, **JSON** and **TXT** tabs including their downloads. This holds for the original, for **Refined** and for a translation, whichever of the two it was made from. Once you have named speakers, the field suggests those names.

## Merging speakers

Give two speakers the same name and transkribierBAR treats them as one person. The panel then shows them in one row with a note such as **2 merged**, and their dots have the same color. This helps when detection split one person into two.

## Changing a single row

If an utterance was assigned to the wrong person, click the pencil icon in the **Speaker** column of the row (**Edit speaker name**). Type the name of the right person and confirm with Enter. Type it exactly as it is already shown, and the row belongs to that person. The pencil icon exists only for rows with a speaker and not in the **Refined** and **Translated** views.

This change applies to that one row only and, like any text change, is only permanent after **Save changes** (see "Subtitle Editor").

## How the names are saved

**Apply** saves the names to the server straight away, independent of **Save changes**. They apply to this transcription only. When you open it again later, the same names are there. The original label stays stored in the transcript itself; the names are added when it is displayed and in the formats.
