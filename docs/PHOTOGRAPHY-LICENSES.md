# Marketing imagery provenance

The images in `assets/images/cloudhost247/photography/` were refreshed with AI-generated
illustrations. They are illustrative scenes, **not photographs of CloudHost247 facilities,
equipment, or staff**. The `network-switch` asset reuses the generated `network-cables` scene.
The former Pexels search-preview imagery is no longer used in this image library.

`shared/site/photography.json` contains the scene mapping, descriptive alt text, and provenance.
The 640, 960 and 1280 pixel AVIF and WebP versions are mirrored to the Node frontend's public
media directory, with JPEG masters retained as fallbacks. The shared site generator projects the
mapping to the PHP and React components.

The SVG and legacy 3D artwork remain as fallback assets. Other imagery, including the newer
homepage and contact page images, is not part of this refresh.

## Wide hero backgrounds

`assets/images/cloudhost247/hero-backgrounds/` contains AI-generated, photographic-style
scenes. They are illustrative, not photographs of CloudHost247 staff or facilities. The compact
React application heroes use these by subject; related pages can share a scene. These images are
not a substitute for individually licensed photography, and the PHP and other hero variants have
not yet received the same background treatment.
