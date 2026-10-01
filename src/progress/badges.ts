/** The badges a student can earn. Order is the order shown in «إنجازاتي». */
import type { Bilingual } from '../model/library';

export interface Badge extends Bilingual {
  id: string;
  /** Emoji shown on the badge (drawn by the system font, so it works offline). */
  icon: string;
  desc: Bilingual;
}

export const BADGES: Badge[] = [
  { id: 'first-light', icon: '💡', ar: 'أول ضوء', en: 'First light', desc: { ar: 'أضأت مصباحاً أو ثنائياً ضوئياً.', en: 'You lit a lamp or an LED.' } },
  { id: 'first-sound', icon: '🔊', ar: 'أول نغمة', en: 'First tone', desc: { ar: 'جعلت السماعة أو الجرس يصدر صوتاً.', en: 'You made a speaker or buzzer sound.' } },
  { id: 'meter', icon: '📏', ar: 'القياس أولاً', en: 'Measure first', desc: { ar: 'قست جهداً أو تياراً بجهاز قياس.', en: 'You measured a voltage or current.' } },
  { id: 'scope', icon: '📈', ar: 'عين المهندس', en: 'Engineer’s eye', desc: { ar: 'شاهدت إشارة على راسم الإشارة.', en: 'You watched a signal on the oscilloscope.' } },
  { id: 'oscillator', icon: '〰️', ar: 'صانع الذبذبات', en: 'Oscillator maker', desc: { ar: 'شغّلت المؤقت 555 وهو يتذبذب.', en: 'You ran a 555 timer that oscillates.' } },
  { id: 'counter', icon: '🔢', ar: 'العالم الرقمي', en: 'Digital world', desc: { ar: 'شغّلت عداداً حتى عدّ إلى 5 أو أكثر.', en: 'You ran a counter up to 5 or more.' } },
  {
    id: 'first-burn',
    icon: '🔥',
    ar: 'درس محترق',
    en: 'Burnt lesson',
    desc: { ar: 'احترقت أول قطعة. لا تقلق، هكذا يتعلم المهندسون، وفي نبض لا تخسر شيئاً!', en: 'Your first part burned. Engineers learn this way, and in Nabd it costs nothing!' },
  },
  { id: 'builder', icon: '🛠️', ar: 'المصمم', en: 'Designer', desc: { ar: 'بنيت بنفسك دائرة من 5 قطع أو أكثر تعمل بلا أخطاء.', en: 'You built a working circuit of 5 or more parts yourself.' } },
  { id: 'repair-1', icon: '🔧', ar: 'أول إصلاح', en: 'First repair', desc: { ar: 'وجدت القطعة التالفة في تحدي صيانة وأصلحتها.', en: 'You found and replaced the faulty part in a repair challenge.' } },
  { id: 'repair-ace', icon: '🎯', ar: 'تشخيص دقيق', en: 'Sharp diagnosis', desc: { ar: 'أصلحت عطلاً من أول محاولة بعد القياس.', en: 'You fixed a fault on the first try.' } },
  { id: 'repair-all', icon: '🧰', ar: 'فنّي الصيانة', en: 'Repair technician', desc: { ar: 'أصلحت كل أعطال تحديات الصيانة.', en: 'You fixed every repair challenge.' } },
  { id: 'explorer', icon: '🧭', ar: 'المستكشف', en: 'Explorer', desc: { ar: 'فتحت 10 أمثلة جاهزة.', en: 'You opened 10 examples.' } },
  { id: 'lesson-1', icon: '📘', ar: 'أول تجربة', en: 'First experiment', desc: { ar: 'أكملت أول تجربة من تجارب المنهج.', en: 'You finished your first curriculum experiment.' } },
  { id: 'lesson-5', icon: '📚', ar: 'خمس تجارب', en: 'Five experiments', desc: { ar: 'أكملت خمس تجارب من المنهج.', en: 'You finished five curriculum experiments.' } },
  { id: 'lesson-all', icon: '🏆', ar: 'نجم المختبر', en: 'Lab star', desc: { ar: 'أكملت كل تجارب المنهج في نبض.', en: 'You finished every curriculum experiment in Nabd.' } },
];

export const badgeById = (id: string): Badge | undefined => BADGES.find((b) => b.id === id);
