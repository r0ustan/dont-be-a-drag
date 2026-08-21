/** Lightweight toast notifications for client UI (toasts). */

let text = ''
let visible = false
let endTime = 0

export function showNotification(message: string, durationMs = 3000) {
  text = message
  visible = true
  endTime = Date.now() + durationMs
}

export function getNotification(): { visible: boolean; text: string } {
  if (visible && Date.now() >= endTime) {
    visible = false
    text = ''
  }
  return { visible, text }
}
