// 立即執行的調試日誌，確認腳本載入
console.log('TixCraft Bot content script loaded at:', new Date().toISOString());

class TixCraftBot {
  constructor() {
    console.log('TixCraft Bot instance created');

    this.config = {
      KEYWORD: '',
      TICKET_QUANTITY: '1',
      SESSIONS: 1,
      DOM_CHECK_TIMEOUT: 5000,
      LOAD_WAIT_TIME: 200,
      SUBMIT_DELAY: 100,
      SHOW_ID: '',
      MAX_RETRIES: 3,
      DOM_CHECK_INTERVAL: 1000
    };

    this.stopBot = false;
    this.errorMessage = '';
    this.initTime = Date.now();

    // 統一的日誌系統
    this.logger = {
      log: (message, type = 'info') => {
        const styles = {
          info: 'color: #1a73e8',
          error: 'color: #d93025; font-weight: bold',
          success: 'color: #1e8e3e',
          stop: 'color: #d93025; font-weight: bold; font-size: 14px',
          debug: 'color: #666666; font-style: italic'
        };
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`%c[TixCraftBot ${timestamp}] ${message}`, styles[type]);
      }
    };

    this.setupMessageListeners();
    this.loadSettings();
  }

  setupMessageListeners() {
    // 設置消息監聽器
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Content script received message:', message);

      // 添加 PING 響應
      if (message.type === 'PING') {
        sendResponse({ status: 'alive', timestamp: Date.now() });
        return true;
      }

      switch (message.type) {
        case 'SETTINGS_UPDATED':
          console.log('Updating settings:', message.settings);
          this.updateConfig(message.settings);
          this.initialize();
          sendResponse({ status: 'success' });
          break;

        case 'STOP_BOT':
          console.log('Received stop command');
          this.stopBot = true;
          this.errorMessage = '使用者手動停止搶票';
          this.logger.log('收到停止指令，腳本已停止', 'stop');
          this.updateBotStatus(false, this.errorMessage);
          sendResponse({ status: 'stopped' });
          break;

        default:
          sendResponse({ status: 'unknown_command' });
          break;
      }
      return true;
    });
  }

  async loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get({
        keyword: '',
        quantity: '1',
        session: 1,
        isActive: false,
        showId: ''
      }, (settings) => {
        this.updateConfig(settings);
        this.logger.log('Settings loaded successfully', 'debug');
        resolve(settings);
      });
    });
  }

  updateBotStatus(isActive, errorMessage = '') {
    console.log('Updating bot status:', { isActive, errorMessage });
    try {
      chrome.runtime.sendMessage({
        type: 'BOT_STATUS_UPDATE',
        isActive: isActive,
        errorMessage: errorMessage
      });

      chrome.storage.sync.set({
        isActive: isActive,
        errorMessage: errorMessage
      });
    } catch (error) {
      console.error('Failed to update bot status:', error);
    }
  }

  updateConfig(settings) {
    this.config = {
      ...this.config,
      KEYWORD: settings.keyword,
      TICKET_QUANTITY: settings.quantity,
      SESSIONS: settings.session,
      SHOW_ID: settings.showId
    };

    this.stopBot = false;
    this.errorMessage = '';
    this.logger.log('Config updated successfully', 'debug');
  }

  async checkLoginStatus() {
    try {
      this.logger.log('開始檢查登入狀態...', 'info');

      if (document.readyState !== 'complete') {
        this.logger.log('等待頁面完全加載...', 'debug');
        await new Promise(resolve => {
          window.addEventListener('load', resolve);
          setTimeout(resolve, 5000);
        });
      }

      // 查找登入狀態元素
      const loginText = document.querySelector('a.user-name.justify-content-center span');
      this.logger.log(`登入文字狀態: ${loginText?.textContent}`, 'debug');

      if (!loginText) {
        throw new Error('無法找到登入狀態元素，請檢查網站是否正常運行');
      }

      // 檢查登入狀態
      if (loginText.textContent.trim() === '會員登入') {
        throw new Error('請先登入 TIXCRAFT 會員');
      }

      if (loginText.textContent.trim() !== '會員帳戶') {
        throw new Error('登入狀態異常，請重新登入');
      }

      this.logger.log('登入狀態檢查通過', 'success');
      return true;

    } catch (error) {
      this.logger.log(`登入檢查失敗: ${error.message}`, 'error');
      this.handleError(error);
      return false;
    }
  }

  async openActivityPage() {
    if (!this.config.SHOW_ID) {
      throw new Error('請輸入節目資訊');
    }

    const url = `https://tixcraft.com/activity/game/${this.config.SHOW_ID}`;

    return new Promise((resolve, reject) => {
      try {
        chrome.tabs.create({ url: url }, async (tab) => {
          chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve(tab);
            }
          });
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  utils = {
    waitForElement: async (selector, description, timeout = 5000) => {
      this.logger.log(`等待元素 "${selector}" (${description})...`, 'debug');
      return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const element = document.querySelector(selector);
        if (element && this.utils.isElementReady(element)) {
          this.logger.log(`立即找到元素 "${selector}"`, 'debug');
          resolve(element);
          return;
        }

        const timeoutId = setTimeout(() => {
          observer.disconnect();
          const timeElapsed = Date.now() - startTime;
          this.logger.log(`等待元素 "${selector}" 超時 (${timeElapsed}ms)`, 'error');
          reject(new Error(`找不到${description || selector}，請檢查網站是否正常運行`));
        }, timeout);

        const observer = new MutationObserver((mutations, obs) => {
          const element = document.querySelector(selector);
          if (element && this.utils.isElementReady(element)) {
            clearTimeout(timeoutId);
            obs.disconnect();
            const timeElapsed = Date.now() - startTime;
            this.logger.log(`找到元素 "${selector}" (${timeElapsed}ms)`, 'debug');
            resolve(element);
          }
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true
        });
      });
    },

    isElementReady: (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return !(rect.width === 0 || rect.height === 0);
    },

    triggerEvent: (element, eventType) => {
      const event = new Event(eventType, { bubbles: true, cancelable: true });
      element.dispatchEvent(event);
    }
  };

  async redirectModule() {
    try {
      const rows = await this.utils.waitForElement('table tbody tr.gridc.fcTxt', '場次列表');
      const allRows = document.querySelectorAll('table tbody tr.gridc.fcTxt');

      if (!allRows || allRows.length === 0) {
        throw new Error('找不到任何場次，請檢查網站是否正常運行');
      }

      let targetIndex = this.config.SESSIONS - 1;
      if (targetIndex >= allRows.length || targetIndex < 0) {
        throw new Error(`找不到第 ${this.config.SESSIONS} 場，請檢查場次設定是否正確`);
      }

      const targetRow = allRows[targetIndex];

      const lastTd = targetRow.querySelector('td:last-child');
      if (lastTd && lastTd.textContent.trim() === "已售完") {
        throw new Error(`第 ${this.config.SESSIONS} 場已售完，請選擇其他場次`);
      }

      const dataKey = targetRow.getAttribute('data-key');
      if (!dataKey) {
        throw new Error(`第 ${this.config.SESSIONS} 場的資料異常，請檢查網站是否正常運行`);
      }

      const activityId = window.location.href.split('/game/')[1];
      const targetUrl = `https://tixcraft.com/ticket/area/${activityId}/${dataKey}`;

      this.logger.log(`正在前往: ${targetUrl}`, 'info');
      window.location.href = targetUrl;
    } catch (error) {
      this.handleError(error);
    }
  }

  async areaModule() {
    try {
      const areaList = await this.utils.waitForElement('.zone.area-list', '區域列表');
      const areaLinks = Array.from(areaList.getElementsByTagName('a'))
        .filter(link => this.utils.isElementReady(link));

      if (areaLinks.length === 0) {
        throw new Error('找不到任何可選區域，請檢查網站是否正常運行');
      }

      const areaUrlList = await this.getAreaUrlList();
      const matchingAreas = areaLinks
        .filter(link => link.textContent.includes(this.config.KEYWORD))
        .map(link => ({
          id: link.getAttribute('id'),
          text: link.textContent.trim(),
          url: areaUrlList[link.getAttribute('id')]
        }))
        .filter(area => area.url);

      if (matchingAreas.length === 0) {
        throw new Error(`找不到包含關鍵字「${this.config.KEYWORD}」的區域，請檢查關鍵字設定`);
      }

      const selectedArea = matchingAreas[Math.floor(Math.random() * matchingAreas.length)];
      this.logger.log(`選擇區域: ${selectedArea.text}`, 'success');
      window.location.href = selectedArea.url;
    } catch (error) {
      this.handleError(error);
    }
  }

  async getAreaUrlList() {
    const scripts = document.getElementsByTagName('script');
    for (const script of scripts) {
      const match = script.textContent?.match(/var areaUrlList = (\{[^;]+\});/);
      if (match) {
        try {
          return JSON.parse(match[1]);
        } catch (error) {
          this.logger.log('Failed to parse areaUrlList', 'error');
        }
      }
    }
    throw new Error('areaUrlList not found');
  }

  async ocrModule() {
    try {
      const captchaImg = await this.utils.waitForElement('#TicketForm_verifyCode-image', '驗證碼圖片');
      if (!captchaImg.complete) {
        await new Promise(resolve => captchaImg.onload = resolve);
      }

      const imageData = await this.getBase64Image(captchaImg);
      const result = await this.processImage(imageData);

      if (!result?.text) {
        throw new Error('驗證碼辨識失敗，請檢查OCR服務是否正常運行');
      }

      this.logger.log(`驗證碼辨識結果: ${result.text}`, 'success');
      await this.fillForm(result.text);
    } catch (error) {
      this.handleError(error);
    }
  }

  async getBase64Image(img) {
    return new Promise((resolve, reject) => {
      try {
        this.logger.log('開始處理圖片...', 'info');

        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);

        // 確保輸出的是 PNG 格式
        const dataURL = canvas.toDataURL("image/png");
        this.logger.log('圖片處理完成', 'success');

        resolve(dataURL);
      } catch (error) {
        this.logger.log(`圖片處理失敗: ${error.message}`, 'error');
        reject(error);
      }
    });
  }

  async processImage(imageData) {
    try {
      this.logger.log('準備發送 OCR 請求...', 'info');

      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: 'PROCESS_OCR',
            imageData: imageData
          },
          response => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          }
        );
      });

      if (!result.success) {
        throw new Error(result.error || '未知錯誤');
      }

      this.logger.log(`OCR 辨識成功: ${result.text}`, 'success');
      return result;

    } catch (error) {
      this.logger.log(`OCR 處理失敗: ${error.message}`, 'error');
      throw error;
    }
  }

  async fillForm(captchaText) {
    try {
      const [captchaInput, quantitySelect, agreeCheckbox, submitButton] = await Promise.all([
        this.utils.waitForElement('#TicketForm_verifyCode'),
        this.utils.waitForElement('#TicketForm_ticketPrice_01'),
        this.utils.waitForElement('#TicketForm_agree'),
        this.utils.waitForElement('.mgt-32 button[type="submit"]')
      ]);

      await Promise.all([
        (async () => {
          captchaInput.value = captchaText;
          this.utils.triggerEvent(captchaInput, 'input');
        })(),
        (async () => {
          quantitySelect.value = this.config.TICKET_QUANTITY;
          this.utils.triggerEvent(quantitySelect, 'change');
        })(),
        (async () => {
          if (!agreeCheckbox.checked) {
            agreeCheckbox.checked = true;
            this.utils.triggerEvent(agreeCheckbox, 'change');
          }
        })()
      ]);

      this.logger.log('Form filled successfully', 'success');
      await new Promise(resolve => setTimeout(resolve, this.config.SUBMIT_DELAY));
      submitButton.click();
    } catch (error) {
      this.logger.log(`Form fill failed: ${error.message}`, 'error');
      throw error;
    }
  }

  handleError(error) {
    const errorMessage = error.message;
    this.logger.log('腳本已停止運行', 'stop');
    this.logger.log(errorMessage, 'error');
    this.stopBot = true;

    chrome.runtime.sendMessage({
      type: 'BOT_STATUS_UPDATE',
      isActive: false,
      errorMessage: errorMessage
    });

    chrome.storage.sync.set({
      isActive: false,
      errorMessage: errorMessage
    });
  }

  async initialize() {
    console.log('Initializing TixCraftBot...');
    try {
      // 回報初始化開始
      chrome.runtime.sendMessage({
        type: 'CONTENT_SCRIPT_LOADED',
        status: 'initializing',
        timestamp: Date.now()
      });

      this.logger.log('開始初始化...', 'info');

      // 檢查是否已經載入超過 30 秒
      if (Date.now() - this.initTime > 30000) {
        throw new Error('初始化超時，請重新整理頁面');
      }

      const { isActive } = await new Promise(resolve => {
        chrome.storage.sync.get({ isActive: false }, resolve);
      });
      this.logger.log(`腳本啟用狀態: ${isActive}`, 'debug');

      if (!isActive || this.stopBot) {
        this.logger.log('搶票腳本未啟用或已停止', 'info');
        return;
      }

      // 等待頁面完全加載
      if (document.readyState !== 'complete') {
        this.logger.log('等待頁面完全加載...', 'debug');
        await new Promise(resolve => {
          const loadHandler = () => {
            window.removeEventListener('load', loadHandler);
            resolve();
          };
          window.addEventListener('load', loadHandler);
          // 設置超時，避免永久等待
          setTimeout(resolve, 5000);
        });
      }

      // 檢查登入狀態
      this.logger.log('準備檢查登入狀態...', 'info');
      const isLoggedIn = await this.checkLoginStatus();
      this.logger.log(`登入檢查結果: ${isLoggedIn}`, 'debug');

      if (!isLoggedIn) {
        this.logger.log('未登入，停止執行', 'error');
        return;
      }

      const currentUrl = window.location.href;
      this.logger.log(`當前URL: ${currentUrl}`, 'debug');

      // 根據當前網址執行相應模組
      if (currentUrl.includes('/activity/game/')) {
        this.logger.log('初始化場次選擇模組...', 'info');
        await this.redirectModule();
      } else if (currentUrl.includes('/ticket/area/')) {
        this.logger.log('初始化區域選擇模組...', 'info');
        await this.areaModule();
      } else if (currentUrl.includes('/ticket/ticket/')) {
        this.logger.log('初始化驗證碼模組...', 'info');
        await this.ocrModule();
      } else if (currentUrl.includes('/ticket/checkout')) {
        this.logger.log('到達結帳頁面！', 'success');
        // 發送成功訊息到 popup
        chrome.runtime.sendMessage({
          type: 'BOT_STATUS_UPDATE',
          isActive: false,
          status: 'success',
          errorMessage: '搶票成功！請在10分鐘內完成結帳。'
        });

        // 更新存儲的狀態
        chrome.storage.sync.set({
          isActive: false,
          status: 'success',
          errorMessage: '搶票成功！請在10分鐘內完成結帳。'
        });

        this.stopBot = true;
      } else {
        this.logger.log('當前頁面不需要處理', 'info');
      }

      // 回報初始化完成
      chrome.runtime.sendMessage({
        type: 'CONTENT_SCRIPT_LOADED',
        status: 'ready',
        timestamp: Date.now()
      });

    } catch (error) {
      this.logger.log(`初始化過程發生錯誤: ${error.message}`, 'error');
      this.handleError(error);

      // 回報錯誤狀態
      chrome.runtime.sendMessage({
        type: 'CONTENT_SCRIPT_ERROR',
        error: error.message,
        timestamp: Date.now()
      });
    }
  }
}

// 創建並啟動 Bot
window.addEventListener('DOMContentLoaded', () => {
  console.log('DOM Content Loaded - Creating TixCraftBot instance');
  const bot = new TixCraftBot();
  bot.initialize().catch(error => {
    console.error('Bot initialization failed:', error);
  });
});

// 設置全域錯誤處理器
window.onerror = function (msg, url, lineNo, columnNo, error) {
  console.error('Global error:', {
    message: msg,
    url: url,
    lineNo: lineNo,
    columnNo: columnNo,
    error: error
  });
  return false;
};

// 導出 Bot 實例到全域作用域以便調試
window.TixCraftBot = TixCraftBot;