# Translation

## What translation produces

Translation produces a second version of your subtitles in another language. Every utterance has a translated utterance at the same position. The language model is meant to leave times and speakers unchanged and neither to merge nor to split utterances. If the number of translated utterances does not match, the translation fails.

The original is kept. The translation appears next to **Original** (and **Refined**) as a button, for example **Translated (EN · from original)**. It is saved with the transcription, is there again when you reopen it, and is deleted together with it.

> **Save first.** The translation works with the saved text. Changes in the editor that you have not yet saved with **Save changes** are not included.

## Translating

In the **Subtitles** tab, click **Translate** above the table. The button is there as long as no translation exists. The **Translate to** dialog opens.

![The Translate to dialog; numbered markers highlight the controls](shots/translate.png)

1. **Translation language** chooses the language to translate into.
2. **Source** appears if a refinement exists (see "Source: original or refined").
3. **Translate** starts the translation. **Cancel** closes the dialog.

While the translation runs, the button reads **Translating...** and the selection fields and buttons are locked. With more than 50 utterances, a note says the translation may take several minutes. The page waits for the language model. Stay on it until the dialog closes. If you leave the page anyway, the translation keeps running on the server. You see it when you reopen the transcription later. A new attempt before it has finished fails. Afterwards the editor shows the **Translated** view.

The language of the recording does not work as a target language. If it is known and you choose it, the translation fails and the dialog says why, for example **The transcript is already in German.**

## Source: original or refined

If a refinement exists, the dialog shows the **Source** toggle with **Original** and **Refined**. **Refined** is preselected. Without a refinement there is no toggle, and the translation uses the original. Which source was used is shown on the translation's button: **from original** or **from refined**.

## Viewing, reading and deleting

The **Translated** view is read-only. The **SRT**, **VTT**, **JSON** and **TXT** tabs show the translation as long as **Translated** is selected (see "Format Viewer").

Only one translation exists per transcription. For another language, click **Delete translation** and then translate again. Deleting asks for confirmation first.

## When the source changes

If the text of the source has changed since the translation, an amber note appears next to **Delete translation**: **source has newer content**. The note appears once you reopen the transcription. This happens, for example, if the translation was made from the original and you change text in it and save. If the refinement the translation was made from has been deleted, it reads **source no longer available**. Changes to times or names do not count as new content. The translation itself stays unchanged until you renew it. To do so, click the note. The **Translate to** dialog opens, and translating again replaces the out-of-date translation. If you choose the same language as before, and the same source where the dialog offers **Source**, the dialog says so: **The out-of-date translation will be replaced.**

## If the translation fails

The dialog then shows the reason the server gives, for example **Translation failed**. Without a reason it shows **Translation failed. Please try again.** transkribierBAR repeats individual sections on its own beforehand. If a section still fails, no translation is created. There are no partly translated versions. A new attempt can succeed.

## In a bundle

If a bundle contains a target language, your browser translates automatically after the transcription, the refinement and the analysis. If a refinement exists by then, the translation uses it, otherwise the original. Stay on the page until all steps are finished.
