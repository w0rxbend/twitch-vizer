declare global {
  interface Window {
    PIXEL_CHAT_THEME?: 'razer';
  }
}

window.PIXEL_CHAT_THEME = 'razer';

void import('../pixel-chat/pixel-chat');
