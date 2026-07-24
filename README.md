# LUT Viewer

支持批量预览 LUT 在照片上的套用效果，是个Lut效果的批量预览工具。

## 能做什么？

支持对最多5张照片批量查看Lut套用之后的效果：上传原始照片 -> 批量打开本地的LUT（最多支持999个） -> 查看照片套用Lut之后的效果。
对于看着合眼缘的Lut可以点下每一行开头的“星标”，被星标的Lut会在画面右上角被列出、同时复制一份到 lut_viewer/lut-uploads/{当天日期}/ 路径下，便于后续直接将挑选好的Lut批量导入相机等下游使用场景。

## 使用方法（需要 Python）

先cd到准备存放这个项目的路径下（如Mac用户 /Users/{你的用户名}/Downloads），然后执行：

```bash
git clone https://github.com/Velkan/lut_viewer.git
cd lut_viewer
python3 server.py
```

执行后浏览器会自动访问 http://127.0.0.1:8723，也可以手动打开浏览器直接访问这个链接


## 系统要求

- Python 3
- 现代浏览器（Chrome / Firefox / Edge）
