document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('settingsForm');
  const startButton = document.getElementById('startButton');
  const stopButton = document.getElementById('stopButton');
  const statusDisplay = document.getElementById('status');

  // Debug 日誌函數
  function debugLog(message, type = 'info') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${type.toUpperCase()}: ${message}`);
  }

  // 檢查腳本狀態
  async function checkContentScript(tabId) {
    debugLog('Checking content script status...');
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, (response) => {
        if (chrome.runtime.lastError) {
          debugLog(`Content script check failed: ${chrome.runtime.lastError.message}`, 'error');
          resolve(false);
        } else if (response && response.status === 'alive') {
          debugLog('Content script is alive');
          resolve(true);
        } else {
          debugLog('Content script not responding', 'error');
          resolve(false);
        }
      });
    });
  }

  // 等待腳本載入
  function waitForContentScript(tabId, maxRetries = 3) {
    debugLog(`Waiting for content script on tab ${tabId}`);
    let retries = 0;

    return new Promise((resolve, reject) => {
      const check = async () => {
        const isAlive = await checkContentScript(tabId);
        if (isAlive) {
          resolve(true);
        } else if (retries < maxRetries) {
          retries++;
          debugLog(`Retry ${retries}/${maxRetries}`);
          setTimeout(check, 1000);
        } else {
          reject(new Error('Content script not loaded after max retries'));
        }
      };
      check();
    });
  }

  // 啟動搶票
  async function startBot() {
    try {
      debugLog('Starting bot...');

      const settings = {
        showId: document.getElementById('showId').value,
        keyword: document.getElementById('keyword').value,
        quantity: document.getElementById('quantity').value,
        session: parseInt(document.getElementById('session').value),
        isActive: true,
        errorMessage: ''
      };

      if (!settings.showId) {
        alert('請輸入節目資訊');
        return;
      }

      debugLog('Settings validated', 'info');
      debugLog(JSON.stringify(settings), 'debug');

      // 儲存設定
      await new Promise((resolve) => {
        chrome.storage.sync.set(settings, resolve);
      });

      const targetUrl = `https://tixcraft.com/activity/game/${settings.showId}`;
      debugLog(`Target URL: ${targetUrl}`);

      // 取得當前分頁
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, resolve);
      });

      const currentTab = tabs[0];
      const isOnTixcraft = currentTab.url === targetUrl;

      if (isOnTixcraft) {
        debugLog('Currently on Tixcraft, reloading page...');

        // 重新載入頁面
        await new Promise((resolve) => {
          chrome.tabs.reload(currentTab.id, {}, () => setTimeout(resolve, 1500));
        });

        // 等待腳本載入
        try {
          await waitForContentScript(currentTab.id);
          debugLog('Content script loaded successfully');

          // 發送設定
          chrome.tabs.sendMessage(currentTab.id, {
            type: 'SETTINGS_UPDATED',
            settings: settings
          });

          updateUIState(true);
        } catch (error) {
          debugLog(`Failed to load content script: ${error.message}`, 'error');
          handleMessageError();
        }
      } else {
        debugLog('Creating new tab...');

        // 創建新分頁
        const newTab = await new Promise((resolve) => {
          chrome.tabs.create({ url: targetUrl }, resolve);
        });

        // 等待頁面載入完成
        await new Promise((resolve) => {
          const listener = (tabId, changeInfo, tab) => {
            if (tabId === newTab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              setTimeout(resolve, 1500);
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });

        try {
          await waitForContentScript(newTab.id);
          debugLog('Content script loaded in new tab');

          chrome.tabs.sendMessage(newTab.id, {
            type: 'SETTINGS_UPDATED',
            settings: settings
          });

          updateUIState(true);
        } catch (error) {
          debugLog(`Failed to load content script in new tab: ${error.message}`, 'error');
          handleMessageError();
        }
      }
    } catch (error) {
      debugLog(`Error in startBot: ${error.message}`, 'error');
      handleMessageError();
    }
  }

  // 錯誤處理函數
  function handleMessageError() {
    debugLog('Handling message error', 'error');
    chrome.storage.sync.set({
      isActive: false,
      errorMessage: '無法與腳本建立連接，請重新整理頁面後再試'
    }, () => {
      updateUIState(false, '無法與腳本建立連接，請重新整理頁面後再試');
    });
  }

  // 更新UI狀態
  function updateUIState(isActive, errorMessage = '', botStatus = '') {
    debugLog(`Updating UI - Active: ${isActive}, Error: ${errorMessage}, Status: ${botStatus}`);

    startButton.disabled = isActive;
    stopButton.disabled = !isActive;

    const formInputs = form.querySelectorAll('input, select');
    formInputs.forEach(input => {
      input.disabled = isActive;
    });

    // 處理不同的狀態顯示
    if (botStatus === 'success') {
      statusDisplay.className = 'status success';
      statusDisplay.textContent = errorMessage || '搶票成功！請在10分鐘內完成結帳。';
    } else if (errorMessage) {
      statusDisplay.className = 'status error';
      statusDisplay.textContent = `搶票已停止\n原因：${errorMessage}`;
    } else {
      statusDisplay.className = `status ${isActive ? 'active' : 'inactive'}`;
      statusDisplay.textContent = isActive ? '搶票進行中...' : '搶票腳本未啟用';
    }
  }

  // 事件監聽器設置
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    debugLog('Form submitted');
    startBot();
  });

  stopButton.addEventListener('click', () => {
    debugLog('Stop button clicked');
    chrome.storage.sync.set({
      isActive: false,
      errorMessage: '使用者手動停止搶票'
    }, () => {
      updateUIState(false, '使用者手動停止搶票');
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_BOT' });
        }
      });
    });
  });

  // 監聽來自 content script 的訊息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    debugLog(`Received message: ${JSON.stringify(message)}`);
    if (message.type === 'BOT_STATUS_UPDATE') {
      updateUIState(message.isActive, message.errorMessage, message.status);
    }
    return true;
  });

  // 載入初始狀態
  chrome.storage.sync.get({
    showId: '',
    keyword: '',
    quantity: '1',
    session: 1,
    isActive: false,
    errorMessage: '',
    status: ''
  }, (items) => {
    debugLog('Loading initial state');
    document.getElementById('showId').value = items.showId;
    document.getElementById('keyword').value = items.keyword;
    document.getElementById('quantity').value = items.quantity;
    document.getElementById('session').value = items.session;
    updateUIState(items.isActive, items.errorMessage, items.status);
  });
});