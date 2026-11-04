# Aufnehmen

## Quellen wählen

Klicken Sie in der Übersicht auf **+ Aufnehmen**. Die Schaltfläche erscheint nur, wenn Ihr Browser Aufnahmen unterstützt. Vor dem Start schalten Sie die Quellen ein oder aus.

![Die Seite „Aufnehmen“ vor dem Start mit den drei Quellen und der Schaltfläche zum Starten; nummerierte Markierungen heben die Bedienelemente hervor](shots/record.png)

1. **Mikrofon** schaltet das Mikrofon ein oder aus. Es ist voreingestellt eingeschaltet.
2. Im Feld **Mikrofon** wählen Sie das Gerät. Gibt es nur ein Gerät, zeigt das Feld dessen Namen.
3. **Systemaudio** nimmt zusätzlich auf, was Ihr Computer abspielt. Es ist voreingestellt aus; mehr dazu unter „Systemaudio“ weiter unten.
4. **Kamera** nimmt zusätzlich das Kamerabild auf. Sie ist voreingestellt aus; mehr dazu unter „Kamera“ weiter unten.
5. **Aufnahme starten** startet die Aufnahme (siehe „Aufnehmen“).

Eine Aufnahme braucht Ton: Schalten Sie das Mikrofon oder Systemaudio ein. Die Kamera fügt nur das Bild hinzu. Ist weder Mikrofon noch Systemaudio an, steht dort **Schalten Sie das Mikrofon oder Systemaudio ein.** und **Aufnahme starten** ist gesperrt.

Ihr Browser fragt gegebenenfalls nach der Erlaubnis. Ist der Zugriff blockiert, erscheint ein Hinweis mit der Schaltfläche **Erneut versuchen**. Erlauben Sie den Zugriff dann in den Website-Einstellungen Ihres Browsers.

> **Einwilligung einholen.** Vor dem Start erinnert die Seite Sie: **Nehmen Sie niemanden ohne Erlaubnis auf. Fragen Sie vorher!**

## Aufnehmen

Klicken Sie auf **Aufnahme starten**. Ein kurzer Signalton zeigt den Start an. Die Anzeige zählt die Dauer als Stunden:Minuten:Sekunden hoch, und ein roter Punkt blinkt. Ein grüner Balken zeigt den Pegel; ist die Kamera an, sehen Sie stattdessen das Kamerabild. Die Quellen lassen sich nach dem Start nicht mehr ändern.

Während der Aufnahme stehen **Pause**, **Stopp** und **Verwerfen** bereit. Nach **Pause** heißt die erste Schaltfläche **Fortsetzen**. **Verwerfen** löscht die Aufnahme und führt zurück zum Start.

## Nach dem Stopp

Nach **Stopp** lädt transkribierBAR die Aufnahme automatisch hoch (**Aufnahme wird hochgeladen...**). Danach geht es weiter wie beim Hochladen: Sie sehen die Einstellungen und klicken auf **Transkribieren**. **Verwerfen** steht auch hier bereit. Schlägt der Upload fehl, erscheint eine Fehlermeldung mit **Erneut versuchen** und **Verwerfen**.

Die Datei heißt `recording-` mit Datum und Uhrzeit. Das Format wählt der Browser: bevorzugt WebM, sonst MP4.

## Systemaudio

Mit **Systemaudio** nehmen Sie zusätzlich auf, was Ihr Computer abspielt, etwa ein Online-Meeting. Das Mikrofon wird dann mit dem Systemaudio gemischt; schalten Sie das Mikrofon aus, wird nur Systemaudio aufgenommen. Die Seite kennzeichnet die Funktion als experimentell. Was möglich ist, hängt von Browser und Betriebssystem ab:

- **Chromium-Browser unter Windows (Chrome, Edge, Brave):** Der Browser lässt Sie einen Bildschirm oder einen Tab wählen. Ein ganzer Bildschirm liefert das gesamte Systemaudio, ein Tab nur dessen Ton.
- **Chromium-Browser unter anderen Systemen:** Nur der Ton eines Browser-Tabs ist möglich. Führen Sie das Meeting in einem Tab und wählen Sie diesen Tab aus, wenn der Browser fragt.
- **Firefox unter Linux:** Wählen Sie im Feld **Systemaudioquelle** ein zweites Audio-Eingabegerät, zum Beispiel eine PulseAudio- oder PipeWire-Monitorquelle. Monitorquellen, deren Name mit „Monitor of“ beginnt, stehen dort an erster Stelle und fehlen in der Liste **Mikrofon**, solange ein anderes Gerät übrig bleibt.
- **Firefox unter anderen Systemen:** Die Unterstützung ist eingeschränkt. Verwenden Sie besser einen Chromium-Browser.
- **Mobilgeräte und andere Browser:** **Systemaudio** wird nicht angeboten.

Solange **Systemaudio** an ist, ist **Kamera** gesperrt. Beenden Sie die Freigabe des Bildschirms oder Tabs, endet die Aufnahme. Gelingt die Aufnahme nicht, erscheint eine Fehlermeldung, zum Beispiel wenn Sie die Auswahl des Browsers abgebrochen haben.

## Kamera

Mit **Kamera** nehmen Sie zusätzlich ein Bild auf, dann entsteht eine Videodatei. Der Ton kommt vom Mikrofon, das dafür eingeschaltet sein muss. Im Feld **Kamera** wählen Sie das Gerät. Ist keine Kamera da, steht **Keine Kamera erkannt.** Lässt sich die Kamera nicht öffnen, läuft die Aufnahme nur mit Ton weiter, und eine Meldung weist darauf hin.

## Seite verlassen

Schließen Sie den Tab oder laden Sie die Seite neu, während Sie aufnehmen, pausieren oder gerade eine Aufnahme beendet haben, warnt Sie der Browser.

> **Aufnahme nicht verlieren.** Wechseln Sie innerhalb von transkribierBAR in eine andere Ansicht, etwa mit **← Transkriptionen**, während der Aufnahme oder bis Sie auf **Transkribieren** klicken, werden Sie zuerst gefragt. Wenn Sie bestätigen, wird die Aufnahme verworfen.
