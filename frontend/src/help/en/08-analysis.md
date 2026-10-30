# Analysis

## What analysis does

Analysis has a language model evaluate your transcript, for example as a summary with chapters, as meeting minutes or according to an instruction of your own. The transcript itself stays unchanged. Each result is saved as a separate entry for the transcription and deleted together with it.

You find analysis in the **Analysis** tab of the detail view, next to **Subtitles**. The language model receives the text of the utterances with their start time and speaker. transkribierBAR inserts the names you gave under **Speaker Names**, as they are at the time of creation.

> **Save first.** The analysis works with the saved text. Changes in the editor that you have not yet saved with **Save changes** are not included.

## Creating an analysis

Choose a template and click **Generate**.

![The analysis form with the prompt shown; numbered markers highlight the controls](shots/analysis-form.png)

1. **Select a template** offers the templates (see "Templates"). **Summary with chapters** is preselected.
2. **Define chapters (optional)** appears with **Summary with chapters** (see "Chapters and agenda").
3. **Customize prompt** shows the template's instruction to the language model (see "Customizing the prompt").
4. **Output language** sets the language of the result. It is preset to the language detected in the transcription.
5. **Source** appears if a refinement exists (see "Source: original or refined").
6. **Generate** starts the analysis.

While the analysis runs, the page shows, for example, **Generating Summary with chapters...** and hides the form. The page waits for the language model's reply. Stay on it until the result appears. If you leave the page anyway, the analysis keeps running on the server. You see the result when you reopen the transcription later. A new attempt before it has finished fails.

You can create as many analyses as you like, also with different templates. Each one is a separate entry in the list. **+ New Analysis** opens the form again, **Cancel** closes it. If there is no analysis yet, the form is visible right away.

## Templates

- **Summary with chapters:** an overall summary and chapters with title, time span and a short description.
- **Meeting protocol:** title, participants, key points, decisions and action items with the person responsible.
- **Agenda-based notes:** notes following an agenda. Like the summary, the result appears as text with chapters.
- **Custom:** you write the instruction yourself (see "Customizing the prompt").

## Chapters and agenda

For **Summary with chapters** there is the expandable list **Define chapters (optional)**. With **Add chapter** you create one row per chapter, with a **Chapter title** and a **Brief description**. Either one is enough. Completely empty rows are ignored, **Remove** deletes a row. You can specify up to 30 chapters. The language model arranges the structure accordingly. If a topic does not occur in the recording, the chapter should still appear in the result, with a note in its description and with **—** instead of a time span.

For **Agenda-based notes** the **Agenda** field appears. Paste your agenda there. If you leave it empty, the language model derives the items from the transcript.

## Customizing the prompt

Under **Customize prompt** you see the instruction of the selected template. It is in English and contains placeholders in curly braces, which transkribierBAR otherwise fills in itself. **Reset to template** restores the original text. With **Custom** the field is empty at first.

> **Changed prompt.** As soon as you change the text or use **Custom**, it is sent exactly as it stands. Placeholders are then no longer replaced, and **Define chapters** and **Agenda** are not sent along. The **Output language** still applies.

The language model always replies with structured text (JSON). The page shows results built like a summary or a protocol as cards. All others appear as text.

## Source: original or refined

If a refinement exists, the form shows the **Source** toggle with **Original** and **Refined**. **Refined** is preselected. Without a refinement there is no toggle, and the analysis uses the original. A translation cannot serve as the source.

Below the result it says what it was made from: **from refined** or **from original**. If the text of that source has changed since, the label turns amber with the addition **source has newer content**. If the refinement was deleted, it reads **source no longer available**. Changes to times or names do not count as new content. An existing analysis does not update itself. Create a new one if needed.

## Reading and reusing results

Click an entry to expand it.

![An expanded summary with chapters; numbered markers highlight the controls](shots/analysis-result.png)

1. The name of the template (or **Custom**). The date follows it, and the language model used appears at the right end of the header.
2. The trash icon (**Delete**) deletes the entry after a confirmation prompt.
3. **Copy result** puts the text on the clipboard. **TXT** and **Markdown** download it, as a file named after the recording with the suffix `_analysis`. The buttons appear above and below the result.
4. For chapters, key points, decisions and action items, clicking the time makes the player jump to that spot.

The cross that appears on a card when you hover over it removes that item from the result after a confirmation prompt. Once you confirm, it is saved immediately and cannot be undone. For the summary this applies to chapters, not to the summary text.

Below the result it says once more what it was generated with.

## If the analysis fails

After an error no entry is created, and you can try again. The message appears below **Generate**. Two cases have their own texts:

- **The analysis reached the language model's output limit before it was complete. Try a more focused prompt.** The same request leads there again. Shorten the instruction or make it more precise.
- **The language model returned a malformed response. Please try again.** transkribierBAR has already tried several times on its own. A new attempt can succeed.

## In a bundle

If a bundle contains an analysis preset, your browser creates the analysis automatically after the transcription and the refinement. If a refinement exists by then, it uses it, otherwise the original. In the form, the **Analysis** field loads a preset. **Save as preset** saves the current settings. The "Presets" section has more on this.
