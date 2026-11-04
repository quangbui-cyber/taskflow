/** Teams/Zoom: conservative end-of-call detection; never scan chat messages. */
(() => {
  if (window.__mycreativeConferenceLoaded) return;
  window.__mycreativeConferenceLoaded = true;
  const LEFT = /^(?:you(?: have|['’]ve)? left (?:the )?(?:meeting|call)|(?:the |this )?meeting has (?:been )?ended|(?:the )?host (?:has )?ended (?:the |this )?meeting|bạn đã rời (?:khỏi )?cuộc (?:họp|gọi)|cuộc họp đã kết thúc)[.!]?$/i;
  let reported = false;
  setInterval(() => {
    if (!chrome.runtime?.id) return;
    const headings = document.querySelectorAll('h1, h2, [role="heading"], [role="status"], .meeting-ended');
    const ended = Array.from(headings).some((el) => el.getClientRects().length > 0 && LEFT.test((el.textContent || "").trim()));
    if (ended && !reported) {
      reported = true;
      chrome.runtime.sendMessage({ type: "MEET_LEFT", reason: "left-screen" }).catch(() => undefined);
    } else if (!ended && reported) {
      reported = false;
      chrome.runtime.sendMessage({ type: "MEET_JOINED" }).catch(() => undefined);
    }
  }, 2000);
})();
