# 💕 Are You The One – Tracker

**Staffel 6 · Erstellt von Sabrina**

Ein persönlicher Mitrate-Assistent für die Reality-TV-Sendung *Are You The One*. Paarungen, Matchbox-Ergebnisse und Wahrscheinlichkeiten – alles auf einen Blick, ohne dass man sich alles merken muss.

---

## ✨ Features

- 🌙 **Matching Nights** – Paarungen und Lichteranzahl eintragen
- 📦 **Matchboxen** – Match, Kein Match oder Verkauft festhalten
- 📊 **Analyse** – Wahrscheinlichkeiten per Person (Ryser-Permanente)
- 🔢 **Kreuztabelle** – Übersicht aller Paarungen auf einen Blick
- 🧪 **Experiment-Modus** – Annahmen testen und mit Lichtern abgleichen
- 🔥 **Top 5 Paare** – wahrscheinlichste unbestätigte Matches auf der Startseite
- 💾 **Auto-Speicherung** – localStorage, kein Login nötig
- 📤 **Export / Import** – JSON-Datei für andere Geräte

---

## 🚀 Lokal starten

### Voraussetzungen
- [Node.js](https://nodejs.org/) (Version 18 oder höher)

### Installation

```bash
# Repository klonen
git clone https://github.com/DEIN-USERNAME/ayto-tracker.git
cd ayto-tracker

# Abhängigkeiten installieren
npm install

# Entwicklungsserver starten
npm run dev
```

Die App öffnet sich unter **http://localhost:5173**

---

## 🌐 Deployment auf Vercel (empfohlen, kostenlos)

1. Repository auf [GitHub](https://github.com) hochladen
2. Auf [vercel.com](https://vercel.com) einloggen (kostenlos mit GitHub-Account)
3. „New Project" → GitHub-Repository auswählen
4. Alles auf Standard lassen → **Deploy**
5. Fertig – die App ist unter einer öffentlichen URL verfügbar ✅

---

## 🏗️ Projekt-Struktur

```
ayto-tracker/
├── index.html          # HTML-Einstiegspunkt
├── vite.config.js      # Vite-Konfiguration
├── package.json        # Abhängigkeiten
├── .gitignore
└── src/
    ├── main.jsx        # React-Einstiegspunkt
    └── App.jsx         # Gesamte App (eine Datei)
```

---

## 🧮 Wahrscheinlichkeitsberechnung

Die App verwendet die **Ryser-Permanente** (kombinatorische Mathematik) um zu berechnen, wie wahrscheinlich jede Paarung ein Perfect Match ist.

Dabei werden berücksichtigt:
- Bestätigte Kein-Match-Ergebnisse (Matchbox)
- Wie oft Paare in Matching Nights zusammenstanden (Gewichtung)
- Licht-basierte Ausschlüsse (z.B. 0 Lichter → alle Paarungen dieser Night falsch)

Die Berechnungen sind mathematische Schätzungen, keine Garantien.

---

## 📋 Rechtliches

Privates, nicht-kommerzielles Freizeitprojekt. Steht in keiner Verbindung zu den Produzenten oder Rechteinhabern der Sendung „Are You The One".

---

*Made with 💕 by Sabrina*
