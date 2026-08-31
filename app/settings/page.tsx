'use client';
import { useEffect } from 'react';
import { Button, Form, Input, InputNumber, Select, Typography, message } from 'antd';

const RATIO_OPTS = ['3:4', '4:5', '1:1'].map((v) => ({ value: v }));

export default function SettingsPage() {
  const [form] = Form.useForm();

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((s) => form.setFieldsValue(s));
  }, [form]);

  const save = async (values: Record<string, unknown>) => {
    const r = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (r.ok) message.success('Settings saved');
    else message.error('Save failed');
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <Typography.Title level={4}>Settings</Typography.Title>
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item name="brand" label="Brand handle"><Input /></Form.Item>
        <Form.Item name="defaultTemplate" label="Default template"><Input /></Form.Item>
        <Form.Item name="defaultRatio" label="Default ratio"><Select options={RATIO_OPTS} /></Form.Item>
        <Button type="primary" htmlType="submit">Save</Button>
      </Form>
    </div>
  );
}
