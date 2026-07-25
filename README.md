# LUT Viewer

支持批量预览 LUT 在照片上的套用效果，是个Lut效果的批量预览工具。

## 能做什么？

支持对最多5张照片批量查看Lut套用之后的效果：上传原始照片 -> 批量打开本地的LUT（最多支持999个） -> 查看照片套用Lut之后的效果。
对于看着合眼缘的Lut可以点下每一行开头的“星标”，被星标的Lut会在画面右上角被列出、同时复制一份到 lut_viewer/lut-uploads/{当天日期}/ 路径下，便于后续直接将挑选好的Lut批量导入相机等下游使用场景。

<img width="2213" height="1322" alt="截屏2026-07-24 21 12 17" src="https://github.com/user-attachments/assets/98efc8e4-9b1c-4afe-9c58-8579b1aecd2f" />

## 使用方法（需要 Python）

### Lut批量预览
先cd到准备存放这个项目的路径下（如Mac用户 /Users/{你的用户名}/Downloads），然后执行：

```bash
git clone https://github.com/Velkan/lut_viewer.git
cd lut_viewer
python3 server.py
```

执行后浏览器会自动访问 http://127.0.0.1:8723，也可以手动打开浏览器直接访问这个链接

### Lut结构调整

松下的Lumix Lab app中对于部分机型（比如S9）只支持33-Grid的cube文件，然而找到的Lut不一定都是33-Grid。所以做了一个转换工具，对于指定目录下的的全部Lut文件，批量扫描并转成33-Grid的结构。（已经是33-Grid的不会受影响，可以闭眼扫描文件夹内的全部Lut）

*使用方法*：

也要cd到 lut_viewer 路径下，然后执行下方命令即可：

```bash
python3 resample_lut.py -i 你存放lut的目录，例如 /Users/{你的用户名}/Downloads/luts
```

转好的lut文件会保存在 lut_viewer/output_luts 目录下。

## 系统要求

- Python 3
- 现代浏览器（Chrome / Firefox / Edge）
