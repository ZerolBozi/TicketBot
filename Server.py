import base64

import ddddocr
from robyn import Robyn, Request, jsonify

app = Robyn(__file__)

@app.post("/ocr")
async def ocr_handler(request: Request):
    try:
        # 解析請求體
        body = request.json()
        
        # 獲取base64圖片數據
        image_data = body.get("image")
        if not image_data:
            return jsonify({
                "success": False,
                "error": "No image data provided"
            })
        
        try:
            # 解碼base64數據
            image_binary = base64.b64decode(image_data.split(',')[1] if ',' in image_data else image_data)
        except Exception as e:
            return jsonify({
                "success": False,
                "error": f"Failed to decode base64 image: {str(e)}"
            })
        
        # 初始化OCR
        ocr = ddddocr.DdddOcr(show_ad=False, beta=True)
        
        # 識別文字
        try:
            result = ocr.classification(image_binary)
        except Exception as e:
            return jsonify({
                "success": False,
                "error": f"OCR processing failed: {str(e)}"
            })
        
        # 返回結果
        return jsonify({
            "success": True,
            "text": result
        })
            
    except Exception as e:
        print(f"Error: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        })

# 處理OPTIONS請求，支持CORS
@app.options("/ocr")
async def ocr_options(request: Request):
    return jsonify({})

if __name__ == "__main__":
    app.start(port=5000)