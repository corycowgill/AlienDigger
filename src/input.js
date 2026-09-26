// Keyboard plus on-screen touch controls. Directions are latched so a held key
// or a held thumb keeps drilling; taps fire once per press.

const MAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  KeyE: 'plant', KeyR: 'restart', Space: 'plant',
};

// Order matters only when two directions are held at once.
const DIRS = ['left', 'right', 'up', 'down'];

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

  return {
    held: (a) => down.has(a),
    // true once per physical press
    tapped(a) {
      if (!pressed.has(a)) return false;
      pressed.delete(a);
      return true;
    },
    direction() {
      for (const d of DIRS) if (down.has(d)) return d;
      return null;
    },
    endFrame() { pressed.clear(); },
  };
}
