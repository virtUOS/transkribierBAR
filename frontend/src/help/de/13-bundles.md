# Pakete

## Was ein Paket ist

Ein Paket verknüpft Voreinstellungen für einen wiederkehrenden Ablauf. Es kann eine Transkriptions-Voreinstellung, eine Verfeinerungs-Voreinstellung, eine Analyse-Voreinstellung und eine Zielsprache für die Übersetzung enthalten. Jeder Teil ist optional. Pakete gehören zu Ihrem Konto, und nur Sie sehen sie.

Ist die Transkription fertig, führt transkribierBAR die weiteren Schritte des Pakets nacheinander aus. Sie müssen sie nicht einzeln starten.

## Die Pipeline

![Ablauf eines Pakets: Transkription, Verfeinerung, Analyse, Übersetzung](./assets/bundle-pipeline.svg)

Die Schritte laufen immer in dieser Reihenfolge: **Transkription, Verfeinerung, Analyse, Übersetzung**. Die Transkription läuft immer. Verfeinerung, Analyse und Übersetzung laufen nur, wenn das Paket sie enthält.

Ihr Browser startet diese Schritte nacheinander. Bleiben Sie auf der Seite, bis sie fertig sind. Gibt es dann eine Verfeinerung, verwenden Analyse und Übersetzung sie, sonst das Original. Das Original können Sie in einem Paket nicht wählen.

Ist die Transkription fertig, öffnet sich die Detailansicht. Ein Streifen über dem Editor zeigt den aktuellen Schritt, zum Beispiel **Übersetze nach Englisch...**. Schlägt ein Schritt fehl, laufen die übrigen trotzdem. Danach listet die Meldung **Einige Pipeline-Schritte sind fehlgeschlagen:** auf, was schiefgegangen ist. Das Kreuz schließt sie. Ein Schritt, dessen Voreinstellung Sie inzwischen gelöscht haben, wird übersprungen.

## Paket erstellen

Legen Sie zuerst die Voreinstellungen an, die Sie brauchen, wie im Abschnitt „Voreinstellungen“ beschrieben. Öffnen Sie dann die Seite **Voreinstellungen**, wechseln Sie zum Reiter **Pakete** und klicken Sie auf **+ Neues Paket**. Geben Sie einen **Namen** ein; die übrigen Felder sind optional, und **Keine** lässt einen Teil weg.

![Der Reiter „Pakete“ mit einem gespeicherten Paket und dem Formular für ein neues; nummerierte Markierungen heben die Bedienelemente hervor](shots/bundles.png)

1. Jedes Paket erscheint als Karte mit seinem Namen und den Teilen, die es enthält.
2. Der Stern (**Als Standard setzen**) macht das Paket zum Standard (siehe „Standard-Paket“). **Bearbeiten** ändert das Paket, **Löschen** entfernt es nach der Frage **Dieses Paket löschen?**.
3. **Transkriptions-Voreinstellung...** wählt die Transkriptions-Voreinstellung. **Analyse-Voreinstellung...** und **Verfeinerungs-Voreinstellung...** darunter funktionieren genauso.
4. **Übersetzen nach** wählt die Sprache für die Übersetzung.
5. **Speichern** speichert das Paket, sobald es einen Namen hat.

Beim Löschen eines Pakets bleiben seine Voreinstellungen erhalten.

## Paket verwenden

Bei **Hochladen** und **Aufnehmen** erscheint das Feld **Pakete** in der Gruppe **Voreinstellungen**, sobald Sie Pakete angelegt haben. Wählen Sie dort ein Paket, werden die Einstellungen seiner Transkriptions-Voreinstellung übernommen. Enthält das Paket Verfeinerung, Analyse oder Übersetzung, steht auf der Schaltfläche **Pipeline starten**. Der Abschnitt „Hochladen“ erklärt genauer, wie das abläuft, auch zum vorausgewählten Paket.

## Standard-Paket

Der Stern auf der Karte eines Pakets macht es zum Standard. Der Stern beim Standard-Paket entfernt den Standard wieder. Sie können nur ein Standard-Paket haben. Die Anwendung wählt es beim Öffnen vor und übernimmt die Einstellungen seiner Transkriptions-Voreinstellung. Der Abschnitt „Hochladen“ erklärt die Einzelheiten.

## Paket oder einzelne Schritte?

Ein Paket lohnt sich, wenn Sie viele Aufnahmen gleich behandeln, zum Beispiel immer verfeinern, dann zusammenfassen, dann übersetzen. Für eine einzelne Aufnahme, die anders behandelt werden soll, oder wenn Sie das Ergebnis eines Schritts erst ansehen möchten, starten Sie die Schritte von Hand.
