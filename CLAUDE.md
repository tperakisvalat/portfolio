# Portfolio Site - CLAUDE.md

## About the Developer

**Name:** Timothée Perakis-Valat (tpv)

**Background:**
- Recently graduated from University of Pennsylvania's Huntsman Program (Business + International Studies)
- Very international profile - lived in 6 countries
- Interdisciplinary interests: tech, political science, geopolitics, French beauty brands (family connection)
- Has extensive writing about different regions including China and the US
- Currently working at Hebbia in NYC

**Technical Level:** Beginner-friendly explanations needed. Assume no prior knowledge of technical concepts or best practices.

**Links:**
- 2026 Goals: https://docs.google.com/document/d/1tBCX9dw0gRl5RnJ1Jujtj04mgdBiQqJe89Dr-OsTynU/edit?tab=t.0
- Substack: https://substack.com/@timpv
- LinkedIn: https://www.linkedin.com/in/timothee-perakis/
- X (Twitter): https://x.com/tperakisvalat

---

## Project Overview

**Purpose:** Personal portfolio website - more of an intellectual exercise and personal expression than a strictly professional site. A place to showcase thoughts, writing, and international perspective.

**Core Concept:** Everything lives on a map. The main navigation is a dotted world map reflecting the international nature of the creator.

**Tech Stack:**
- React (using Vite for build tooling)
- React Router DOM for routing
- dotted-map package (https://github.com/NTag/dotted-map) for the world map
- Dark theme: black background with white text
- Terminal-style typography (JetBrains Mono)

---

## Current Features

### Header (Terminal Style)
- Name abbreviation: "tpv"
- Live clocks showing time in Paris, New York, Shanghai
- Links: 2026, Substack, LinkedIn, X

### Scroll-Based Story Animation
The map reveals progressively as you scroll:
1. **Start**: "scroll" prompt with bouncing arrow
2. **Born in Madrid**: Spain lights up with red glow animation
3. **Originally French and Greek**: France and Greece appear
4. **Grew up in Germany and China**: Germany and China appear
5. **Studied in Philadelphia, now NYC**: USA appears
6. **Explore Mode**: Full world map with interactive pins

### Explore Mode Features
- **Visited countries** (light blue): Australia, South Africa, Morocco, UAE, Oman, Egypt, Jordan, Argentina, Brazil, Guatemala, Mexico, France, UK, Spain, Italy, Portugal, Hungary, Greece, Vietnam, Myanmar, Sri Lanka, Japan, Korea, Singapore, Ukraine, Iceland, Germany, China, USA
- **Green neon pins** (clickable): Shanghai, Paris, NYC, SF
- Each pin opens full-page modal with:
  - Intro paragraph
  - Questions I have
  - Writing & projects
  - Things I've read
  - Things I want to read
  - Music player (UI only for now)

### Terminal Text Box
- Persistent below map during story sections
- White `>` prompt with blinking cursor
- Typewriter effect for text
- Clears on scroll to next section

### Admin Panel (/admin)
- Login: username `tpv2002`, password `Kalanda1`
- Edit all 4 region pins (Shanghai, Paris, NYC, SF)
- Add/remove questions, writing, books
- Supports markdown-style links: `[text](url)`
- Saves to localStorage

---

## Progress Tracker

### Completed
- [x] React + Vite project setup
- [x] Terminal-style header with live clocks
- [x] Dotted world map with scroll-based story
- [x] Country-by-country reveal animation (soft red → neon red → white)
- [x] City pins during story (orange=past, red=current)
- [x] Shadow dots at pin locations (animate before pin appears)
- [x] Persistent terminal text box with typewriter effect
- [x] Explore mode with visited countries (light blue)
- [x] Green neon clickable pins for key cities
- [x] Full-page pin modal with sections
- [x] Music player UI (visual only)
- [x] Admin panel with login
- [x] LocalStorage persistence for admin edits
- [x] Markdown link parsing in intro text

### TODO - Next Session
- [ ] **Database setup** (Firebase/Supabase) to replace localStorage
  - Persist admin changes across browsers/devices
  - Proper data storage for production
- [ ] **Music player functionality**
  - Decide on source: Spotify embeds, YouTube, or direct audio files
  - Implement play/pause/mute controls
  - Add actual music URLs/embeds for each region
- [ ] **Mobile responsiveness**
  - Test and fix layout on smaller screens
  - Adjust terminal box, map size, modal for mobile
- [ ] **Deployment**
  - Set up hosting (Vercel, Netlify, or similar)
  - Configure custom domain if desired
- [ ] **Content**
  - Fill in real content for each region's questions, reading lists, writing
  - Add actual links to writing/projects

### Future Ideas
- [ ] More interactive map features (hover effects on visited countries)
- [ ] Analytics to track pin clicks
- [ ] Blog/writing section integrated with Substack
- [ ] Dark/light mode toggle

---

## File Structure
```
portfolio-site/
├── src/
│   ├── components/
│   │   ├── Header.jsx        # Terminal-style header with clocks
│   │   ├── WorldMap.jsx      # Dotted map + story + explore mode
│   │   └── Admin.jsx         # Admin panel with login
│   ├── App.jsx               # Main app component
│   ├── App.css               # All styles (dark theme, animations, admin)
│   └── main.jsx              # Entry point with React Router
├── index.html
├── vite.config.js
├── package.json
└── CLAUDE.md
```

## How to Run

1. Open terminal in this folder
2. Run `npm run dev`
3. Open http://localhost:5173 in your browser
4. Admin panel: http://localhost:5173/admin

---

## Technical Notes

### LocalStorage Data
Admin edits are stored in `localStorage.explorePins`. This persists in the browser but:
- Only works on the same browser/device
- Clears if browser data is cleared
- Not suitable for production (needs database)

### Animation Timing
- `ANIMATION_DURATION`: 2400ms total for section animations
- `COUNTRY_DELAY`: 0.6s between sequential country animations
- `DOT_ANIMATION`: 1.2s for dot glow effect
- `TYPEWRITER_SPEED`: 25ms per character

### Markdown Links
In admin intro text, use `[link text](url)` format for hyperlinks.
