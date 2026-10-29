# Transkriptionseinstellungen

Die Einstellungen erscheinen bei **Hochladen**, sobald Sie eine Datei gewählt haben, und bei **Aufnehmen**, sobald die Aufnahme hochgeladen ist. Sie sind in Gruppen geordnet.

![Die Transkriptionseinstellungen mit eingeblendeten erweiterten Optionen; nummerierte Markierungen heben die vier Gruppen hervor](shots/settings.png)

1. **Voreinstellungen**: eine gespeicherte Voreinstellung laden, die aktuellen Einstellungen speichern oder ein Paket wählen (siehe „Voreinstellungen“ unten).
2. **Transkription**: Sprache und Modell (siehe „Sprache und Modell“).
3. **Sprechende**: die Erkennung der Sprechenden und die Zahl der Personen (siehe „Sprechende erkennen“).
4. **Erweiterte Optionen**: Anfangs-Prompt und Schlüsselwörter (siehe „Erweiterte Optionen“).

## Sprache und Modell

Die Gruppe **Transkription** enthält zwei Felder.

**Sprache für die Transkription:** Voreingestellt ist **Automatisch erkennen**; dann bestimmt die Spracherkennung die Sprache selbst. Kennen Sie die Sprache, wählen Sie sie aus der Liste. Oben stehen Deutsch, Englisch, Spanisch, Französisch und Türkisch, darunter nach einem Trennstrich alle weiteren Sprachen in alphabetischer Reihenfolge. Die Spracherkennung bestimmt die Sprache anhand der ersten 30 Sekunden der Aufnahme; enthalten diese Musik, Stille oder eine andere Sprache, kann sie falsch liegen. Bei **Automatisch erkennen** zeigt die Detailansicht die erkannte Sprache unter dem Titel.

**Qualität:** Die Liste bietet die konfigurierten Modelle an, jeweils mit einer kurzen Beschreibung und dem Namen, zum Beispiel **Ausgewogen (large-v3-turbo)** und **Beste Qualität (large-v3)**. Voreingestellt ist {{default_model}}. **Beste Qualität** ist das vollständige Modell und braucht deutlich länger; **Ausgewogen** ist das kleinere, schnellere Modell. Bietet Ihre Installation nur ein Modell an, heißt das Feld **Modell**, ist schreibgeschützt und zeigt es an.

## Sprechende erkennen

Die Gruppe **Sprechende** enthält den Schalter **Sprechende erkennen**. Er ist voreingestellt eingeschaltet und trennt die Beiträge verschiedener Personen. Spricht nur eine Person, können Sie ihn ausschalten.

Ist der Schalter an, können Sie die Zahl der Personen eingrenzen: **Mindestanzahl Personen** (voreingestellt 1) und **Höchstanzahl Personen** (voreingestellt 2). Erlaubt sind Werte von 1 bis 20. Setzen Sie die Mindestanzahl über die Höchstanzahl, zieht die Höchstanzahl nach, und umgekehrt.

Namen für die erkannten Personen vergeben Sie nach der Transkription im Reiter **Untertitel** unter **Namen der Sprechenden**.

## Erweiterte Optionen

Mit **Erweiterte Optionen** blenden Sie zwei weitere Felder ein. Beide sind optional.

- **Anfangs-Prompt:** Kontext für die Transkription, zum Beispiel das Thema oder Eigennamen.
- **Schlüsselwörter:** kommagetrennte Fachbegriffe.

Beide Angaben gehen an die Spracherkennung. Leere Felder werden nicht übermittelt.

Die beiden Felder teilen sich einen begrenzten Platz, weil die Spracherkennung beide jedem Abschnitt der Aufnahme voranstellt. Unter den Feldern sehen Sie, wie viel von diesem Platz sie belegen. Sind sie zusammen zu lang, weist ein roter Hinweis darauf hin, und sowohl die Schaltfläche, die die Transkription startet, als auch **Als Voreinstellung speichern** bleiben gesperrt, bis Sie sie kürzen. Der Hinweis erscheint auch bei geschlossenen erweiterten Optionen, zum Beispiel nachdem Sie eine Voreinstellung mit langen Angaben gewählt haben.

## Voreinstellungen

Die Gruppe **Voreinstellungen** ist die erste Gruppe.

- **Transkription:** Dieses Auswahlfeld erscheint, sobald Sie Voreinstellungen gespeichert haben. Wählen Sie dort eine Voreinstellung, übernimmt sie Sprache, Sprechende, Anfangs-Prompt und Schlüsselwörter.
- **Als Voreinstellung speichern:** Geben Sie einen Namen ein und bestätigen Sie mit dem Häkchen oder mit der Eingabetaste. transkribierBAR speichert die aktuellen Einstellungen unter diesem Namen.
- **Pakete:** Dieses Feld erscheint, sobald Sie Pakete angelegt haben. Was es bewirkt, steht im Abschnitt „Hochladen“.

Voreinstellungen verwalten Sie auf der Seite **Voreinstellungen** in der Kopfzeile.

## Die Zusammenfassung

Nach dem Klick auf **Transkribieren** ersetzt eine Zeile die Einstellungen. Sie nennt den Dateinamen, die Größe, das Modell, die Sprache (**automatisch**, wenn Sie nichts gewählt haben), die Sprechenden (**keine Sprechenden** oder zum Beispiel **1–2 Personen**) und gegebenenfalls das Paket.
