# The Finance Student — homepage concept

A static, no-build concept for the thefinancestudent.com homepage. Open `index.html` or serve the folder with GitHub Pages.

```
python3 -m http.server   # then visit http://localhost:8000
```

## What's in it
- **Intro**: only "Finance." shows at first, then the rest of the page opens out of the centre of the "a".
- **Hero**: an intraday chart. "Finance." is the price and its period is the last trade, tagged on the % scale. A crosshair rests on the period and follows the mouse, with the time, % change, high and low updating as it moves. Below it, an edge-to-edge strip of logos from the firms students most want to work for (it pauses on hover).
- **About statement**: the words darken as you scroll through them.
- **Career list**: the employer programs featured on the site. Each row fills with paprika on hover.
- **Cities**: Ottawa, Toronto and Hamilton panels slide in from the right and stack, each leaving a strip of the panel underneath. Each has a large photo and city name.
- **Footer**: menus, email-alert signup (front end only), and a static "The Finance Student" with equal gaps on both sides.

Motion follows Emil Kowalski's animation guidelines (github.com/emilkowalski/skills).

## Structure
```
index.html
css/style.css
js/main.js           intro reveal, hero chart, marquee, scroll effects, Lenis smooth scroll (CDN)
assets/fonts/        SK Modernist (free font by Sebastian Kosch, check the licence before production)
assets/img/          city photos, FS logo
assets/logos/        firm logos (official SVGs from Wikimedia Commons)
```

## Notes
- Links and buttons are placeholders.
- Logos belong to their owners. Confirm you're allowed to show them before launch.
- Palette: Floral White `#fffcf2`, Charcoal Brown `#403d39`, Carbon Black `#252422`, Spicy Paprika `#eb5e28`.
