// Mock @devvit/web/client for testbed mode

/**
 * Navigate to a URL - in testbed mode convert Reddit URLs to local URLs
 */
export function navigateTo(url) {
  console.log('[TESTBED] Navigate to:', url);

  // Convert Reddit post URLs to local testbed URLs
  if (url.includes('reddit.com')) {
    const match = url.match(/\/comments\/([^/?]+)/);
    if (match) {
      const postId = match[1];
      const localUrl = `/r/testbed/comments/${postId}`;
      console.log('[TESTBED] Redirecting to local:', localUrl);
      window.location.href = localUrl;
      return;
    }
  }

  window.location.href = url;
}

/**
 * Request expanded mode - navigate to entrypoint HTML with postId preserved
 */
export function requestExpandedMode(event, entrypoint) {
  console.log('[TESTBED] requestExpandedMode called:', entrypoint);

  // Extract postId from current URL (path or query param)
  const pathMatch = window.location.pathname.match(/\/comments\/([^/]+)/);
  const postId = pathMatch ? pathMatch[1] : new URLSearchParams(window.location.search).get('postId');

  const target = postId ? `/${entrypoint}.html?postId=${postId}` : `/${entrypoint}.html`;
  console.log('[TESTBED] Navigating to entrypoint:', target);
  window.location.href = target;
}
