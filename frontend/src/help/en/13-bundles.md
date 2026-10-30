# Bundles

## What a bundle is

A bundle ties presets together for a recurring workflow. It can contain a transcription preset, a refinement preset, an analysis preset and a target language for translation. Each part is optional. Bundles belong to your account, and only you see them.

Once the transcription has finished, transkribierBAR carries out the further steps of the bundle one after another. You do not have to start each one yourself.

## The pipeline

![How a bundle runs: transcription, refinement, analysis, translation](./assets/bundle-pipeline.svg)

The steps always run in this order: **transcription, refinement, analysis, translation**. The transcription always runs. Refinement, analysis and translation only run if the bundle contains them.

Your browser starts these steps, one after another. Stay on the page until they have finished. If a refinement exists by then, analysis and translation use it, otherwise the original. You cannot choose the original in a bundle.

When the transcription is finished, the detail view opens. A strip above the editor shows the current step, for example **Translating to English...**. If a step fails, the others still run. Afterwards the message **Some pipeline steps failed:** lists what went wrong. The cross closes it. A step whose preset you have deleted in the meantime is skipped.

## Creating a bundle

Create the presets you need first, as described in the section "Presets". Then open the **Presets** page, switch to the **Bundles** tab and click **+ New bundle**. Enter a **Name**; the other fields are optional, and **None** leaves a part out.

![The Bundles tab with a saved bundle and the form for a new one; numbered markers highlight the controls](shots/bundles.png)

1. Each bundle appears as a card with its name and the parts it contains.
2. The star (**Set as default**) makes the bundle the default (see "Default bundle"). **Edit** changes the bundle, **Delete** removes it after the question **Delete this bundle?**.
3. **Transcription preset...** chooses the transcription preset. **Analysis preset...** and **Refinement preset...** below it work the same way.
4. **Translate to** chooses the language for the translation.
5. **Save** saves the bundle once it has a name.

Deleting a bundle does not delete its presets.

## Using a bundle

In **Upload** and **Record**, the **Bundles** field in the **Presets** group appears once you have created bundles. If you choose a bundle there, the settings of its transcription preset are applied. If the bundle contains refinement, analysis or translation, the button reads **Run pipeline**. The section "Upload" explains in detail how this works, including the preselected bundle.

## Default bundle

The star on a bundle's card makes it the default. The star on the default bundle removes the default again. You can have only one default bundle. The app preselects it when it opens and applies its transcription preset to the settings. The section "Upload" explains the details.

## Bundle or manual steps?

A bundle pays off when you treat many recordings the same way, for example always refine, then summarize, then translate. For a single recording that needs different treatment, or if you want to look at the result of a step first, start the steps by hand.
