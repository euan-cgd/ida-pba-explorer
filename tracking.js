// tracking.js
// Implements the CGD Interactive Analytics Tracking Standard.

(() => {
  const PARENT_ORIGIN = 'https://www.cgdev.org';
  const INTERACTIVE_NAME = window.CGD_INTERACTIVE_NAME || 'ida-pba-explorer';
  const VALID_ACTION_TYPES = new Set([
    'filter',
    'preset',
    'detail_open',
    'detail_close',
    'view_control',
    'navigate',
    'compare',
    'external_link',
    'download'
  ]);

  let viewTracked = false;

  function send(eventName, params) {
    if (typeof window === 'undefined' || !window.parent) return;
    window.parent.postMessage(
      Object.assign({ type: 'cgd_analytics', event: eventName }, params),
      PARENT_ORIGIN
    );
  }

  function trackView() {
    if (viewTracked) return;
    viewTracked = true;
    send('interactive_view', {
      interactive_name: INTERACTIVE_NAME
    });
  }

  function trackEngagement(actionType, actionLabel, actionValue) {
    if (!VALID_ACTION_TYPES.has(actionType)) return;
    const params = {
      interactive_name: INTERACTIVE_NAME,
      action_type: actionType,
      action_label: actionLabel
    };
    if (actionValue !== undefined && actionValue !== null && actionValue !== '') {
      params.action_value = String(actionValue);
    }
    send('interactive_engagement', params);
  }

  window.CGDTracking = {
    INTERACTIVE_NAME,
    trackView,
    trackEngagement
  };
})();
