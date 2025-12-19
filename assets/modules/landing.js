const STORAGE_KEY = 'constellations.exploreDisclaimer.v1';

function qs(sel) {
    return document.querySelector(sel);
}

function show(el) {
    el?.setAttribute('data-open', 'true');
}

function hide(el) {
    el?.removeAttribute('data-open');
}

function isOpen(el) {
    return el?.getAttribute('data-open') === 'true';
}

function trapFocus(modalEl) {
    const focusable = modalEl.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    function onKeydown(e) {
        if (e.key !== 'Tab' || focusable.length === 0) return;

        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    modalEl.addEventListener('keydown', onKeydown);
    return () => modalEl.removeEventListener('keydown', onKeydown);
}

function setDisclaimerSeen() {
    try {
        localStorage.setItem(STORAGE_KEY, '1');
    } catch {
        // ignore storage errors (private mode, etc.)
    }
}

function hasSeenDisclaimer() {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

function initExploreDisclaimer() {
    const cta = qs('a.cta-main');
    const modal = qs('#experimental-modal');
    const overlay = qs('#experimental-modal-overlay');
    const btnCancel = qs('#experimental-modal-cancel');
    const btnContinue = qs('#experimental-modal-continue');

    if (!cta || !modal || !overlay || !btnCancel || !btnContinue) return;

    let cleanupTrap = null;
    let lastActive = null;

    function openModal(destinationHref) {
        lastActive = document.activeElement;

        // Store destination to navigate on continue
        btnContinue.setAttribute('data-href', destinationHref);

        overlay.setAttribute('aria-hidden', 'false');
        show(overlay);
        show(modal);
        document.body.style.overflow = 'hidden';

        cleanupTrap = trapFocus(modal);

        // Focus primary button
        btnContinue.focus();
    }

    function closeModal() {
        if (cleanupTrap) cleanupTrap();
        cleanupTrap = null;

        hide(modal);
        hide(overlay);
        overlay.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';

        if (lastActive && typeof lastActive.focus === 'function') lastActive.focus();
        lastActive = null;
    }

    cta.addEventListener('click', (e) => {
        const href = cta.getAttribute('href');
        if (!href) return;

        if (hasSeenDisclaimer()) {
            // allow normal navigation
            return;
        }

        e.preventDefault();
        openModal(href);
    });

    btnCancel.addEventListener('click', (e) => {
        e.preventDefault();
        closeModal();
    });

    btnContinue.addEventListener('click', (e) => {
        e.preventDefault();
        const href = btnContinue.getAttribute('data-href') || cta.getAttribute('href');
        setDisclaimerSeen();
        window.location.href = href;
    });

    // Overlay click closes
    overlay.addEventListener('click', () => {
        if (isOpen(modal)) closeModal();
    });

    // If user clicks outside modal (on overlay) it closes; but don't close on internal clicks
    modal.addEventListener('click', (e) => e.stopPropagation());

    // Extra: close modal on Escape even if focus is inside buttons
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen(modal)) {
            e.preventDefault();
            closeModal();
        }
    });
}

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initExploreDisclaimer);
} else {
    initExploreDisclaimer();
}
