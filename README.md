# Cue — Church Presentation App

Cue is a cross-platform church presentation application for macOS and Windows. It helps an operator find and prepare visuals privately, then send selected content to a separate TV or projector during a church service.

## Vision

- **Operator display:** Search and browse images, prepare and preview slides, organize cues, and manage the service without exposing preparation to the audience.
- **Audience display:** Show only the selected image, slide, video, or ambient background.
- **Quick visual search:** Find an image (for example, a map of Turkey), preview it, then send it to the audience screen with a deliberate **Show on TV** action, without manually saving or switching apps.
- **Library and cues:** Reuse maps, photos, GIFs, videos, and saved sequences while supporting spontaneous additions.
- **Slides:** Import PDFs and create simple text slides; PowerPoint and Keynote decks may be exported to PDF.
- **Ambient mode:** Display backgrounds or rotate visuals before, between, or after sessions.
- **Live controls:** Fit/fill, video playback and volume, instant blackout, and one-click return to lesson slides.

## Design direction

A calm, polished dark graphite control desk with warm amber accents, large previews, clear distinction between **Preview** and **Live**, and accessible controls suitable for a dim church booth.

## Development priorities

1. Reliable dual-display behavior and intentional take-live workflow.
2. macOS and Windows compatibility.
3. Resilience when offline for slides and previously saved media.
4. An image-search integration that respects the provider's embedding, copyright, and usage constraints.
5. Smooth media switching and sound behavior on real church display hardware.

## Project status

An earlier Apple Silicon Mac prototype and a browser preview reportedly exist, with the Google-image-to-audience workflow tested on Mac. **Those source files are not yet in this repository.** If available, inspect and reuse them before rebuilding. The church TV connection, full-screen display, and video audio still need on-site rehearsal.

## Build notes

This repository is being prepared for Claude development. Claude should inspect any existing source code, choose an appropriate cross-platform architecture, and keep instructions for setup, running, building, and testing up to date as implementation progresses.
