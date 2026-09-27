// Keyboard, on-screen touch controls, and gamepads. Everything funnels into one
// action model -- directions latch while held so drilling continues, taps fire
// once per press -- so the game, the title screen and the Foundry all read the
// same three methods regardless of what the player is holding.

const MAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  KeyE: 'plant', KeyR: 'restart', Space: 'plant', KeyM: 'mute',
  KeyH: 'help', Slash: 'help',
};

// Order matters only when two directions are held at once.
const DIRS = ['left', 'right', 'up', 'down'];

// Standard gamepad mapping, which is what an Xbox pad reports. Face buttons
// double up deliberately: A is the one-thumb answer to every prompt, and both
// Y and Start launch, because which one a player reaches for is not worth
// guessing at.
const PAD_BUTTONS = {
  0: 'plant',      // A
  3: 'restart',    // Y
  2: 'help',       // X
  4: 'mute',       // LB
  9: 'restart',    // Start / Menu
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right',
};
// Generous, because this is a grid game: a half-pushed stick should commit to a
// direction rather than hovering between two.
const STICK_DEADZONE = 0.45;

export function createInput() {
  const down = new Set();
  const pressed = new Set();

  const press = (a) => { if (!down.has(a)) pressed.add(a); down.add(a); };
  const release = (a) => down.delete(a);

  addEventListener('keydown', (e) => {
    const a = MAP[e.code];
    if (!a) return;
    e.preventDefault();
    press(a);
  });
  addEventListener('keyup', (e) => {
    const a = MAP[e.code];
    if (a) release(a);
  });
  addEventListener('blur', () => down.clear());

  // --------------------------------------------------------------- touch
  // A pointer that starts on a d-pad button holds that direction until it is
  // lifted, and slides between buttons without needing to be lifted first.
  const held = new Map();   // pointerId -> action

  function actionAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el && el.dataset ? (el.dataset.dir || null) : null;
  }

  function bindTouch() {
    const pad = document.querySelector('#touch .pad');
    if (!pad) return;

    const set = (id, action) => {
      const prev = held.get(id);
      if (prev === action) return;
      if (prev) release(prev);
      if (action) { press(action); held.set(id, action); } else { held.delete(id); }
      for (const b of pad.querySelectorAll('button')) {
        b.classList.toggle('on', [...held.values()].includes(b.dataset.dir));
      }
    };

    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      set(e.pointerId, actionAt(e.clientX, e.clientY));
    });
    pad.addEventListener('pointermove', (e) => {
      if (!held.has(e.pointerId)) return;
      e.preventDefault();
      set(e.pointerId, actionAt(e.clientX, e.clientY));
    });
    const lift = (e) => {
      if (!held.has(e.pointerId)) return;
      e.preventDefault();
      set(e.pointerId, null);
    };
    pad.addEventListener('pointerup', lift);
    pad.addEventListener('pointercancel', lift);
    pad.addEventListener('pointerleave', lift);

    for (const btn of document.querySelectorAll('#touch [data-tap]')) {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        press(btn.dataset.tap);
        // a tap is momentary: release on the next frame so tapped() sees it once
        requestAnimationFrame(() => release(btn.dataset.tap));
      });
    }
  }

  if (document.readyState === 'loading') {
    addEventListener('DOMContentLoaded', bindTouch);
  } else {
    bindTouch();
  }

  // ---------------------------------------------------------- gamepad
  // Polled rather than evented, so it has to diff against the previous frame to
  // turn held buttons into the same press/release pairs a key produces.
  let padHeld = new Set();
  let padSeen = false;

  addEventListener('gamepadconnected', () => {
    padSeen = true;
    document.body.classList.add('gamepad');
  });

  function poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const now = new Set();

    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      if (!padSeen) { padSeen = true; document.body.classList.add('gamepad'); }

      pad.buttons.forEach((b, i) => {
        if (b && b.pressed && PAD_BUTTONS[i]) now.add(PAD_BUTTONS[i]);
      });

      const [x = 0, y = 0] = pad.axes;
      if (x < -STICK_DEADZONE) now.add('left');
      else if (x > STICK_DEADZONE) now.add('right');
      if (y < -STICK_DEADZONE) now.add('up');
      else if (y > STICK_DEADZONE) now.add('down');
    }

    for (const a of now) if (!padHeld.has(a)) press(a);
    for (const a of padHeld) if (!now.has(a)) release(a);
    padHeld = now;
  }

  return {
    poll,
    hasGamepad: () => padSeen,
    held: (a) => down.has(a),
    // true once per physical press
    tapped(a) {
      if (!pressed.has(a)) return false;
      pressed.delete(a);
      return true;
    },
    // Two held directions combine into a diagonal. Vertical is named first so
    // the player module can read one key consistently.
    direction() {
      const v = down.has('up') ? 'up' : down.has('down') ? 'down' : '';
      const h = down.has('left') ? 'left' : down.has('right') ? 'right' : '';
      if (v && h) return v + h;
      return v || h || null;
    },
    endFrame() { pressed.clear(); },
  };
}
