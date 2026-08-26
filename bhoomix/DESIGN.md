# BhoomiX Design System

## Brand Identity
- **Product**: BhoomiX — AI-Assisted Cadastral Mapping Platform
- **Tagline**: "Precision Land Intelligence, Powered by AI"
- **Personality**: Professional, authoritative, data-rich, precise

---

## Color Palette

### Base (UI Chrome)
| Token              | Hex       | Usage                                    |
|--------------------|-----------|------------------------------------------|
| `bhoomix-bg`       | `#0B0F1A` | App background / dark canvas             |
| `bhoomix-surface`  | `#111827` | Sidebar, panels, cards                   |
| `bhoomix-surface2` | `#1E2535` | Elevated panels, modals                  |
| `bhoomix-border`   | `#2D3748` | Dividers, borders                        |
| `bhoomix-muted`    | `#4B5563` | Placeholder text, disabled states        |
| `bhoomix-text`     | `#E2E8F0` | Primary text                             |
| `bhoomix-subtext`  | `#94A3B8` | Secondary / metadata text                |

### Brand Accent
| Token              | Hex       | Usage                                    |
|--------------------|-----------|------------------------------------------|
| `bhoomix-primary`  | `#6366F1` | Primary CTA, selected parcels, links     |
| `bhoomix-primary-hover` | `#4F46E5` | Hover state for primary                 |
| `bhoomix-glow`     | `rgba(99,102,241,0.2)` | Glow / shadow on active elements  |

### Parcel Status Colors (Map Layer Fills)
| Token              | Hex       | Status           | Usage                          |
|--------------------|-----------|------------------|--------------------------------|
| `parcel-ai`        | `#F59E0B` | AI Suggestion    | Amber — unvalidated AI parcels |
| `parcel-confirmed` | `#10B981` | Confirmed        | Emerald — verified parcels     |
| `parcel-conflict`  | `#F43F5E` | Conflict/Dispute | Rose — overlapping/disputed    |
| `parcel-pending`   | `#94A3B8` | Pending Review   | Slate — awaiting action        |
| `parcel-selected`  | `#6366F1` | Selected         | Indigo — user-selected parcel  |

### Semantic Colors
| Token         | Hex       | Usage             |
|---------------|-----------|-------------------|
| `success`     | `#10B981` | Success states    |
| `warning`     | `#F59E0B` | Warnings          |
| `error`       | `#F43F5E` | Errors, conflicts |
| `info`        | `#38BDF8` | Info banners      |

---

## Typography

- **Font Family**: `Inter` (Google Fonts) — clean, technical, data-friendly
- **Mono Font**: `JetBrains Mono` — coordinate display, parcel IDs, SQL output

| Scale     | Size   | Weight | Usage                              |
|-----------|--------|--------|------------------------------------|
| `display` | 2rem   | 700    | Page titles                        |
| `heading` | 1.25rem| 600    | Panel/section headings             |
| `body`    | 0.875rem| 400   | Body text, labels                  |
| `small`   | 0.75rem | 400   | Metadata, timestamps, coordinates  |
| `mono`    | 0.75rem | 500   | IDs, GeoJSON, coordinates          |

---

## Spacing & Layout

- **Base unit**: 4px
- **Sidebar width**: 280px (collapsible)
- **Header height**: 52px
- **Panel padding**: 16px
- **Map canvas**: Fills remaining viewport (flex-1)
- **Border radius**: `sm=4px`, `md=8px`, `lg=12px`, `xl=16px`

---

## Component Specifications

### Sidebar
- Background: `bhoomix-surface` (#111827)
- Border-right: 1px `bhoomix-border`
- Width: 280px fixed, collapsible with 52px icon rail
- Sections: Logo, Nav Items, Layer Controls, Legend

### Map Canvas
- Background: `bhoomix-bg` (dark basemap)
- Full height minus header
- MapLibre GL JS renderer
- Custom dark map style via OpenFreeMap Liberty

### Parcel Info Panel (right drawer)
- Width: 360px
- Slides in from right on parcel click
- Shows: Parcel ID, Status badge, Confidence score progress bar, Area, Land Use, Audit trail

### Status Badges
- Pill shape, `border-radius: 9999px`
- Font: `small` mono
- Colors match parcel status tokens above

### Action Buttons
- Primary: `bhoomix-primary` fill, white text, hover `bhoomix-primary-hover`
- Ghost: transparent fill, `bhoomix-border` border, `bhoomix-text` text
- Danger: `error` fill

### Confidence Score Bar
- Track: `bhoomix-border`
- Fill: gradient from `parcel-ai` (amber) to `parcel-confirmed` (green) based on score

---

## Map Layer Styling

### Parcel Fill (MapLibre expression)
```json
["match", ["get", "status"],
  "ai_suggestion", "#F59E0B",
  "confirmed",     "#10B981",
  "conflict",      "#F43F5E",
  "pending",       "#94A3B8",
  "#6366F1"
]
```

### Parcel Fill Opacity: `0.35`
### Parcel Stroke: `1.5px`, same color as fill at `opacity: 0.9`
### Selected parcel: `opacity: 0.6`, stroke `3px` `#6366F1`

---

## Icons
- Library: **Lucide React** (consistent, MIT-licensed)
- Size: 16px (inline), 20px (sidebar nav), 24px (large actions)

---

## Shadows & Elevation
| Level | CSS                                      | Usage            |
|-------|------------------------------------------|------------------|
| `sm`  | `0 1px 3px rgba(0,0,0,0.4)`             | Cards            |
| `md`  | `0 4px 12px rgba(0,0,0,0.5)`            | Panels, drawers  |
| `glow`| `0 0 20px rgba(99,102,241,0.25)`        | Active/selected  |

---

## Animation
- **Transition duration**: 150ms (micro), 250ms (panels), 350ms (drawers)
- **Easing**: `cubic-bezier(0.4, 0, 0.2, 1)` (material ease)
- Map layer paint transitions: 300ms
