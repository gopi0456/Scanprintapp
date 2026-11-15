import { registerPlugin, Capacitor } from '@capacitor/core';

const Printer = registerPlugin('Printer');

export async function nativePrint(base64, name) {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    await Printer.print({ base64, name });
    return true;
  } catch (e) {
    console.warn('Native print failed:', e);
    return false;
  }
}
