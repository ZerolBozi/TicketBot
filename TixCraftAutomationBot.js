// ==UserScript==
// @name         TixCraft Automation Bot
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Integrated ticket booking automation for TixCraft
// @author       Weirdo
// @match        https://tixcraft.com/activity/game/*
// @match        https://tixcraft.com/ticket/area/*
// @match        https://tixcraft.com/ticket/ticket/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// ==/UserScript==

(function() {
    'use strict';

    // 配置常數
    const CONFIG = {
        KEYWORD: '一樓', // 要搜尋的區域關鍵字
        TICKET_QUANTITY: '1', // 要購買的票數
        SESSIONS: 1, // 場次選擇 (第幾場)
        MAX_RETRIES: 20, // 最大重試次數
        RETRY_INTERVAL: 50, // 重試間隔(ms)
        LOAD_WAIT_TIME: 200, // 等待頁面加載時間(ms)
        SUBMIT_DELAY: 100, // 表單提交延遲(ms)
        DOM_CHECK_INTERVAL: 50, // DOM檢查間隔(ms)
    };

    // 工具函數
    const utils = {
        // 等待元素出現並確保可交互
        waitForElement: async function(selector, maxAttempts = CONFIG.MAX_RETRIES) {
            for (let i = 0; i < maxAttempts; i++) {
                const element = document.querySelector(selector);
                if (element && this.isElementReady(element)) {
                    return element;
                }
                await new Promise(resolve => setTimeout(resolve, CONFIG.DOM_CHECK_INTERVAL));
            }
            throw new Error(`Element not found or not ready: ${selector}`);
        },

        // 檢查元素是否真正可交互
        isElementReady: function(element) {
            if (!element) return false;

            // 檢查元素是否可見
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }

            // 檢查元素位置和大小
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) {
                return false;
            }

            return true;
        },

        // 優化的頁面加載等待
        waitForPageLoad: async function() {
            const checkReadiness = async () => {
                // 檢查頁面基本加載狀態
                if (document.readyState !== 'complete') {
                    return false;
                }

                // 確保主要內容容器已加載
                const mainContent = document.querySelector('#main-content');
                if (!mainContent) {
                    return false;
                }

                // 檢查是否還有正在加載的資源
                const pendingImages = Array.from(document.images).filter(img => !img.complete);
                if (pendingImages.length > 0) {
                    return false;
                }

                return true;
            };

            let attempts = 0;
            while (attempts < CONFIG.MAX_RETRIES) {
                if (await checkReadiness()) {
                    await new Promise(resolve => setTimeout(resolve, CONFIG.LOAD_WAIT_TIME));
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, CONFIG.DOM_CHECK_INTERVAL));
                attempts++;
            }
        },

        // 發送網絡請求並確保響應
        sendRequest: async function(url, options = {}) {
            const defaultHeaders = {
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8',
                'cache-control': 'no-cache',
                'pragma': 'no-cache',
                'sec-ch-ua': '"Chromium";v="130", "Not?A_Brand";v="99"',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'same-origin',
                'upgrade-insecure-requests': '1',
                'x-requested-with': 'XMLHttpRequest'
            };

            const requestOptions = {
                method: 'GET',
                headers: { ...defaultHeaders, ...options.headers },
                credentials: 'include',
                mode: 'cors',
                cache: 'no-store',
                ...options
            };

            // 添加超時處理
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Request timeout')), 5000)
            );

            const fetchPromise = fetch(url, requestOptions);
            const response = await Promise.race([fetchPromise, timeoutPromise]);

            if (!response.ok) {
                throw new Error(`Request failed: ${response.status}`);
            }

            return response;
        },

        // 優化的事件觸發器
        triggerEvent: function(element, eventType) {
            const event = new Event(eventType, { bubbles: true, cancelable: true });
            element.dispatchEvent(event);
        }
    };

    // 自動跳轉模組
    const redirectModule = {
        async execute() {
            try {
                const rows = await utils.waitForElement('table tbody tr.gridc.fcTxt', CONFIG.MAX_RETRIES);
                const allRows = document.querySelectorAll('table tbody tr.gridc.fcTxt');

                if (!allRows || allRows.length === 0) {
                    throw new Error('No sessions found');
                }

                let targetIndex = CONFIG.SESSIONS - 1;

                if (targetIndex >= allRows.length || targetIndex < 0) {
                    console.warn(`Session ${CONFIG.SESSIONS} is out of range (total ${allRows.length} sessions). Defaulting to session 1.`);
                    targetIndex = 0;
                }

                const targetRow = allRows[targetIndex];
                const dataKey = targetRow.getAttribute('data-key');

                if (!dataKey) {
                    throw new Error(`No data-key found for session ${CONFIG.SESSIONS}`);
                }

                const sessionInfo = targetRow.textContent.trim();
                console.log(`Selected session ${targetIndex + 1} of ${allRows.length}: ${sessionInfo}`);

                const activityId = window.location.href.split('/game/')[1];
                const targetUrl = `https://tixcraft.com/ticket/area/${activityId}/${dataKey}`;

                console.log(`Navigating to: ${targetUrl}`);

                // 直接使用瀏覽器導航，不進行預檢請求
                window.location.href = targetUrl;

            } catch (error) {
                console.error('Redirect failed:', error);
                if (error.message.includes('not found') || error.message.includes('No sessions')) {
                    console.log(`Retrying redirect in ${CONFIG.RETRY_INTERVAL}ms...`);
                    setTimeout(() => this.execute(), CONFIG.RETRY_INTERVAL);
                } else {
                    throw error;
                }
            }
        }
    };
    // 區域選擇模組
    const areaModule = {
        async getAreaUrlList() {
            const scripts = document.getElementsByTagName('script');
            for (const script of scripts) {
                const match = script.textContent?.match(/var areaUrlList = (\{[^;]+\});/);
                if (match) {
                    try {
                        return JSON.parse(match[1]);
                    } catch (error) {
                        console.error('Failed to parse areaUrlList:', error);
                    }
                }
            }
            throw new Error('areaUrlList not found');
        },

        async execute() {
            try {
                const areaList = await utils.waitForElement('.zone.area-list');
                const areaLinks = Array.from(areaList.getElementsByTagName('a'))
                    .filter(link => utils.isElementReady(link));
                const areaUrlList = await this.getAreaUrlList();

                const matchingAreas = areaLinks
                    .filter(link => link.textContent.includes(CONFIG.KEYWORD))
                    .map(link => ({
                        id: link.getAttribute('id'),
                        text: link.textContent.trim(),
                        url: areaUrlList[link.getAttribute('id')]
                    }))
                    .filter(area => area.url);

                if (matchingAreas.length === 0) {
                    throw new Error(`No areas found matching keyword: ${CONFIG.KEYWORD}`);
                }

                const selectedArea = matchingAreas[Math.floor(Math.random() * matchingAreas.length)];
                await utils.sendRequest(selectedArea.url);
                window.location.href = selectedArea.url;

            } catch (error) {
                console.error('Area selection failed:', error);
                // 重試機制
                setTimeout(() => this.execute(), CONFIG.RETRY_INTERVAL);
            }
        }
    };

    // OCR模組
    const ocrModule = {
        async getBase64Image(img) {
            return new Promise((resolve, reject) => {
                try {
                    const canvas = document.createElement("canvas");
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(img, 0, 0);
                    resolve(canvas.toDataURL("image/png"));
                } catch (error) {
                    reject(error);
                }
            });
        },

        async processImage(imageData) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'http://localhost:5000/ocr',
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify({ image: imageData }),
                    timeout: 5000, // 添加超時設置
                    onload: response => {
                        try {
                            resolve(JSON.parse(response.responseText));
                        } catch (error) {
                            reject(error);
                        }
                    },
                    onerror: reject,
                    ontimeout: () => reject(new Error('OCR request timeout'))
                });
            });
        },

        async fillForm(captchaText) {
            // 並行等待所有表單元素
            const [captchaInput, quantitySelect, agreeCheckbox, submitButton] = await Promise.all([
                utils.waitForElement('#TicketForm_verifyCode'),
                utils.waitForElement('#TicketForm_ticketPrice_01'),
                utils.waitForElement('#TicketForm_agree'),
                utils.waitForElement('.mgt-32 button[type="submit"]')
            ]);

            // 並行處理表單填寫
            await Promise.all([
                // 填寫驗證碼
                (async () => {
                    captchaInput.value = captchaText;
                    utils.triggerEvent(captchaInput, 'input');
                })(),
                // 設置票數
                (async () => {
                    quantitySelect.value = CONFIG.TICKET_QUANTITY;
                    utils.triggerEvent(quantitySelect, 'change');
                })(),
                // 勾選同意
                (async () => {
                    if (!agreeCheckbox.checked) {
                        agreeCheckbox.checked = true;
                        utils.triggerEvent(agreeCheckbox, 'change');
                    }
                })()
            ]);

            // 延遲提交
            await new Promise(resolve => setTimeout(resolve, CONFIG.SUBMIT_DELAY));
            submitButton.click();
        },

        async execute() {
            try {
                const captchaImg = await utils.waitForElement('#TicketForm_verifyCode-image');

                if (!captchaImg.complete) {
                    await new Promise(resolve => captchaImg.onload = resolve);
                }

                const imageData = await this.getBase64Image(captchaImg);
                const result = await this.processImage(imageData);

                if (!result?.text) {
                    throw new Error('Invalid OCR result');
                }

                await this.fillForm(result.text);
            } catch (error) {
                console.error('OCR processing failed:', error);
                // 重試機制
                setTimeout(() => this.execute(), CONFIG.RETRY_INTERVAL);
            }
        }
    };

    // 主控制模組
    const controller = {
        async initialize() {
            try {
                const currentUrl = window.location.href;
                if (currentUrl.includes('/activity/game/')) {
                    await redirectModule.execute();
                } else if (currentUrl.includes('/ticket/area/')) {
                    await areaModule.execute();
                } else if (currentUrl.includes('/ticket/ticket/')) {
                    await ocrModule.execute();
                }
            } catch (error) {
                console.error('Initialization failed:', error);
                // 全局重試機制
                setTimeout(() => this.initialize(), CONFIG.RETRY_INTERVAL);
            }
        }
    };

    // 立即執行初始化
    controller.initialize();
})();