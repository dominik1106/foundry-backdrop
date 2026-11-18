const ID = "backdrop";

/** @type {HTMLDivElement|null} */
let wallpaper = null;

/** cached client setting */
let enabled = true;

/** whether a wallpaper is actually shown; read every frame by the canvas ticker */
let active = false;

//global settings
Hooks.once("init", () => {
  const { NumberField } = foundry.data.fields;

  game.settings.register(ID, "enabled", {
    name: "Show backdrop",
    hint: "Turn the backdrop off on this device, e.g. to save performance. Only affects this browser.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: (value) => {
      enabled = value;
      applyWallpaper();
    },
  });
  enabled = game.settings.get(ID, "enabled");

  game.settings.register(ID, "image", {
    name: "Wallpaper image",
    hint: "Default wallpaper. Scenes can override it in their configuration.",
    scope: "world",
    config: true,
    type: String,
    filePicker: "image",
    default: `modules/${ID}/assets/table.jpg`,
    onChange: applyWallpaper,
  });

  game.settings.register(ID, "blur", {
    name: "Wallpaper blur",
    hint: "Blur radius in screen pixels. 0 = off. Scenes can override it in their configuration.",
    scope: "world",
    config: true,
    type: new NumberField({
      nullable: false,
      integer: true,
      min: 0,
      max: 20,
      step: 1,
      initial: 3,
    }),
    default: 3,
    onChange: applyWallpaper,
  });
});

// scene config overrides
Hooks.on("renderSceneConfig", (app, root, _context, options) => {
  // AppV2 can re-render individual parts, only inject when the basics part was rendered
  if (options.parts && !options.parts.includes("basics")) return;
  if (root.querySelector(`.${ID}-overrides`)) return;

  const esc = foundry.utils.escapeHTML;
  const disabled = app.document.getFlag(ID, "disabled") ?? false;
  const image = app.document.getFlag(ID, "image") ?? "";
  const overrideBlur = app.document.getFlag(ID, "overrideBlur") ?? false;
  const blur =
    app.document.getFlag(ID, "blur") ?? game.settings.get(ID, "blur");

  const fieldset = document.createElement("fieldset");
  fieldset.classList.add(`${ID}-overrides`);
  fieldset.innerHTML = `
    <legend>Backdrop</legend>
    <div class="form-group">
      <label>Disable backdrop</label>
      <div class="form-fields">
        <input type="checkbox" name="flags.${ID}.disabled" ${disabled ? "checked" : ""}>
      </div>
      <p class="hint">Show the plain scene background colour instead of a wallpaper in this scene.</p>
    </div>
    <div class="form-group">
      <label>Wallpaper image</label>
      <div class="form-fields">
        <file-picker name="flags.${ID}.image" type="image" value="${esc(image)}"></file-picker>
      </div>
      <p class="hint">Overrides the global wallpaper for this scene. Leave empty for the default.</p>
    </div>
    <div class="form-group">
      <label>Wallpaper blur</label>
      <div class="form-fields">
        <input type="checkbox" name="flags.${ID}.overrideBlur" ${overrideBlur ? "checked" : ""}
               data-tooltip="Override the global blur">
        <range-picker name="flags.${ID}.blur" min="0" max="20" step="1" value="${Number(blur)}"></range-picker>
      </div>
      <p class="hint">Check to override the global blur for this scene.</p>
    </div>`;

  // the image and blur fields are greyed out while the backdrop is disabled,
  // and the slider is only active while its override is checked
  const field = (key) => fieldset.querySelector(`[name="flags.${ID}.${key}"]`);
  const [off, picker, toggle, slider] = [
    "disabled",
    "image",
    "overrideBlur",
    "blur",
  ].map(field);
  const sync = () => {
    picker.disabled = toggle.disabled = off.checked;
    slider.disabled = off.checked || !toggle.checked;
  };
  off.addEventListener("change", sync);
  toggle.addEventListener("change", sync);
  sync();

  const target =
    root.querySelector('.tab[data-tab="basics"]') ?? root.querySelector("form");
  target?.append(fieldset);
});

/**
 * if the scene config is set use that, otherwise fall back to global config
 * image uses `||` so an empty string falls back, blur only applies while its override checkbox is set.
 * a scene with the backdrop disabled resolves to no image, which keeps the canvas opaque.
 */
function getConfig(scene = canvas.scene) {
  const globalBlur = game.settings.get(ID, "blur");
  const disabled = scene?.getFlag(ID, "disabled") ?? false;
  return {
    image: disabled
      ? null
      : scene?.getFlag(ID, "image") || game.settings.get(ID, "image"),
    blur: scene?.getFlag(ID, "overrideBlur")
      ? (scene.getFlag(ID, "blur") ?? globalBlur)
      : globalBlur,
  };
}

// make sure the background is transparent, so it shows the image
Hooks.on("canvasConfig", (config) => {
  if (enabled) config.backgroundAlpha = 0;
});

// without a wallpaper (disabled or no image), restore Foundry's opaque scene background
function syncBackgroundAlpha() {
  canvas.app.renderer.background.alpha = active ? 0 : 1;
}

Hooks.once("canvasReady", () => {
  // HIGH priority runs before foundrys render step each frame
  canvas.app.ticker.add(syncBackgroundAlpha, null, PIXI.UPDATE_PRIORITY.HIGH);
});

// set wallpaper
Hooks.once("ready", () => {
  wallpaper = document.createElement("div");
  wallpaper.id = `${ID}-wallpaper`;
  document.getElementById("board").before(wallpaper); // directly behind the canvas
  applyWallpaper();
});

Hooks.on("canvasReady", applyWallpaper);

Hooks.on("updateScene", (scene, changes) => {
  if (scene === canvas.scene && changes.flags?.[ID]) applyWallpaper();
});

function applyWallpaper() {
  const { image, blur } = getConfig();
  // computed even before the element exists, so the canvas never flashes transparent
  active = enabled && !!image;
  if (!wallpaper) return;
  wallpaper.hidden = !active;
  if (!active) return;
  // without the double en-/decode umlauts for example break it
  wallpaper.style.backgroundImage = `url("${encodeURI(decodeURI(image))}")`;
  wallpaper.style.filter = blur > 0 ? `blur(${blur}px)` : "";
  // blurred edges fade to transparent, so extend the element past the screen
  wallpaper.style.inset = `${-blur * 3}px`;
}
