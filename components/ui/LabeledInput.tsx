'use client';
import React from 'react';
import { Input, Space, theme } from 'antd';
import type { InputProps } from 'antd';

type Size = 'small' | 'middle' | 'large';

/**
 * The label welded to a field's left edge — what `addonBefore` used to draw before antd
 * deprecated it in favour of `Space.Compact`. Compact only flattens the radii of antd's own
 * children, so the label paints the addon's surface itself and the control beside it gives up
 * its left corners to meet it (see `flatStart`).
 */
export function FieldLabel({ size = 'middle', children }: { size?: Size; children: React.ReactNode }) {
  const { token } = theme.useToken();
  const pad = size === 'small' ? token.paddingXS : token.paddingSM;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        whiteSpace: 'nowrap',
        padding: `0 ${pad}px`,
        fontSize: size === 'small' ? token.fontSizeSM : token.fontSize,
        color: token.colorText,
        background: token.colorFillAlter,
        border: `${token.lineWidth}px solid ${token.colorBorder}`,
        borderInlineEnd: 'none',
        borderStartStartRadius: token.borderRadius,
        borderEndStartRadius: token.borderRadius,
      }}
    >
      {children}
    </span>
  );
}

/** The control's own left corners, squared off so the label and the field read as one box. */
export const flatStart = { borderStartStartRadius: 0, borderEndStartRadius: 0 } as const;

/** An `Input` with a `FieldLabel` on its left. */
export default function LabeledInput({
  label,
  style,
  ...rest
}: { label: React.ReactNode } & InputProps) {
  return (
    <Space.Compact style={{ width: '100%', ...style }}>
      <FieldLabel size={rest.size === 'large' ? 'large' : rest.size === 'small' ? 'small' : 'middle'}>
        {label}
      </FieldLabel>
      <Input {...rest} style={flatStart} />
    </Space.Compact>
  );
}
