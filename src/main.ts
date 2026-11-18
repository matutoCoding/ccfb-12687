import './styles.css';
import { store } from './state/store';
import { startRouter } from './ui/router';
import { toast } from './ui/dom';

async function bootstrap() {
  const boot = document.getElementById('boot')!;
  try {
    await store.init();
    boot.remove();
    startRouter();
  } catch (err) {
    boot.textContent = `初始化失败：${(err as Error).message}（本系统依赖 IndexedDB 与 WebGL2）`;
  }
  window.addEventListener('offline', () => toast('网络已断开，数据仍保存在本地，可继续开工', 'warn'));
  window.addEventListener('online', () => toast('网络恢复', 'ok'));
}

bootstrap();
