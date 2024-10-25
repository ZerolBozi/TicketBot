chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PROCESS_OCR') {
        processOCR(message.imageData)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // 保持消息通道開啟
    }
});

async function processOCR(imageData) {
    try {
        const response = await fetch('http://localhost:5000/ocr', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ image: imageData })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OCR request failed (${response.status}): ${errorText}`);
        }

        return await response.json();
    } catch (error) {
        console.log('OCR processing failed:', error);
        throw error;
    }
}