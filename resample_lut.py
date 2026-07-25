import argparse
import os
import sys

import colour


def convert_to_33(input_file_path, output_file_path):
    """
    将单个 .cube LUT 转换为33点 .cube LUT（已经是33的则跳过）。

    返回 True 表示转换成功，False 表示跳过或失败。
    """
    try:
        print(f"  读取: {input_file_path}")
        lut = colour.read_LUT(input_file_path)

        if lut is None:
            print(f"  跳过: 无法读取LUT文件，请检查格式。")
            return False

        # 确认为 3D LUT
        if not hasattr(lut, "size"):
            print(f"  跳过: 不是3D LUT。")
            return False
        if lut.size == 33:
            print(f"  跳过: 已经是 33-grid，无需转换。")
            return False

        print(f"  原始 LUT 尺寸: {lut.size}-grid ({lut.table.shape})")

        # 生成 33^3 的线性采样坐标，用源 LUT 做 trilinear 插值重采样
        print(f"  正在重采样 {lut.size} -> 33 ...")
        sample_coords = colour.LUT3D.linear_table(33)
        resampled_table = lut.apply(sample_coords)

        # 构造目标 LUT，继承元数据
        lut_33 = colour.LUT3D(
            table=resampled_table,
            name=lut.name,
            domain=lut.domain,
            comments=lut.comments,
        )

        colour.write_LUT(lut_33, output_file_path)
        print(f"  输出: {output_file_path}")
        return True

    except Exception as e:
        print(f"  错误: {e}")
        return False


def batch_convert(input_dir, output_dir):
    """遍历 input_dir 下所有 .cube 文件，批量转换为 33-grid。"""
    if not os.path.isdir(input_dir):
        print(f"错误: 输入目录不存在: {input_dir}")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    cube_files = sorted(
        f for f in os.listdir(input_dir)
        if f.lower().endswith(".cube")
    )

    if not cube_files:
        print(f"未在 {input_dir} 中找到任何 .cube 文件。")
        return

    success = 0
    skipped = 0

    for filename in cube_files:
        in_path = os.path.join(input_dir, filename)
        out_path = os.path.join(output_dir, filename)

        print(f"\n[{filename}]")
        if convert_to_33(in_path, out_path):
            success += 1
        else:
            skipped += 1

    print(f"\n完成: {success} 个转换成功, {skipped} 个跳过。")


def main():
    parser = argparse.ArgumentParser(
        description="将目录下所有非 33-grid 的 .cube LUT 批量转换为 33-grid"
    )
    parser.add_argument(
        "-i", "--input-dir",
        required=True,
            help="输入目录，包含待转换的 .cube 文件",
    )
    parser.add_argument(
        "-o", "--output-dir",
        default=None,
        help="输出目录（默认: 项目根下的 output_luts）",
    )

    args = parser.parse_args()

    # 默认输出目录为脚本所在项目根下的 output_luts
    if args.output_dir is None:
        project_root = os.path.dirname(os.path.abspath(__file__))
        output_dir = os.path.join(project_root, "output_luts")
    else:
        output_dir = args.output_dir

    batch_convert(args.input_dir, output_dir)


if __name__ == "__main__":
    main()
