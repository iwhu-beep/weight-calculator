import { Haptics, ImpactStyle } from '@capacitor/haptics'

// 按键音 - 复用单例 AudioContext，避免每次按键都新建导致内存累积
let audioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext | null {
  try {
    if (!audioCtx) audioCtx = new AudioContext()
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {})
    }
    return audioCtx
  } catch { /* ignore */ }
  return null
}

export function playKeySound() {
  const ctx = getAudioCtx()
  if (!ctx) return
  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 1200
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.06)
  } catch { /* ignore */ }
}

// 触觉反馈 - 依赖 Capacitor 原生插件，浏览器中自动忽略
export async function playHaptic() {
  try {
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch { /* ignore */ }
}

// 语音读数
export function speakNumber(text: string, voice: SpeechSynthesisVoice | null, rate: number) {
  try {
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    if (voice) utter.voice = voice
    utter.lang = voice?.lang ?? 'zh-CN'
    utter.rate = rate
    utter.pitch = 1.0
    window.speechSynthesis.speak(utter)
  } catch { /* ignore */ }
}
