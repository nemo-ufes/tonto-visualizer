interface PanOptions {
    viewport: HTMLElement;
    button: HTMLElement;
    initial: boolean;
    canStart(): boolean;
    move(dx: number, dy: number): void;
    changed(): void;
}

/** Navigation is captured before node, resize, bend and selection handlers. */
export function installPanControls(options: PanOptions): { readonly active: boolean } {
    const { viewport, button } = options;
    let active = options.initial;
    let space = false;
    let gesture: { pointerId: number; x: number; y: number; moved: boolean } | undefined;
    let suppressClickUntil = 0;

    function update(): void {
        button.setAttribute('aria-pressed', String(active));
        viewport.classList.toggle('pan-enabled', active || space);
        viewport.classList.toggle('pan-dragging', !!gesture);
    }

    function finish(): void {
        if (!gesture) {
            return;
        }
        const { pointerId } = gesture;
        gesture = undefined;
        // Pointerup can click a package badge, even after a temporary modifier is released.
        suppressClickUntil = performance.now() + 350;
        if (viewport.hasPointerCapture(pointerId)) {
            viewport.releasePointerCapture(pointerId);
        }
        update();
    }

    function editable(target: EventTarget | null): boolean {
        return target instanceof Element && !!target.closest(
            'input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])');
    }

    button.addEventListener('click', () => {
        active = !active;
        update();
        options.changed();
    });
    window.addEventListener('keydown', event => {
        const control = editable(event.target) || event.target instanceof Element
            && !!event.target.closest('button, a[href], [role="button"]');
        if (event.code === 'Space' && !control && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            event.stopImmediatePropagation();
            space = true;
            update();
        } else if (event.key === 'Escape' && (active || space || gesture) && !editable(event.target)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            active = false;
            space = false;
            finish();
            update();
            options.changed();
        }
    }, true);
    window.addEventListener('keyup', event => {
        if (event.code === 'Space') {
            space = false;
            update();
        }
    }, true);
    function resetTemporary(): void {
        space = false;
        finish();
        update();
    }
    window.addEventListener('blur', resetTemporary);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            resetTemporary();
        }
    });

    viewport.addEventListener('pointerdown', event => {
        if (gesture) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        const wanted = event.button === 1 || event.button === 0 && (active || space || event.altKey);
        if (!wanted || !options.canStart()) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        viewport.focus({ preventScroll: true });
        gesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        viewport.setPointerCapture(event.pointerId);
        update();
    }, true);
    viewport.addEventListener('pointermove', event => {
        if (!gesture || event.pointerId !== gesture.pointerId) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        const dx = event.clientX - gesture.x;
        const dy = event.clientY - gesture.y;
        if (!gesture.moved && Math.hypot(dx, dy) < 3) {
            return;
        }
        gesture.moved = true;
        gesture.x = event.clientX;
        gesture.y = event.clientY;
        // Screen pixels, independent of zoom; no model or arrangement writes.
        options.move(dx, dy);
    }, true);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
        viewport.addEventListener(type, event => {
            if (gesture?.pointerId === event.pointerId) {
                event.stopImmediatePropagation();
                finish();
            }
        }, true);
    }
    for (const type of ['click', 'dblclick', 'auxclick'] as const) {
        viewport.addEventListener(type, event => {
            if (active || space || event.altKey || event.button === 1 || performance.now() < suppressClickUntil) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        }, true);
    }
    update();
    return { get active() { return active; } };
}
