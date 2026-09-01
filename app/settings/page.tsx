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

        <Typography.Title level={5} style={{ marginTop: 24 }}>Talking heads</Typography.Title>
        <Form.Item
          name="lipsyncSteps"
          label="Sampling steps"
          extra="Four is the draft LoRA: quick, but it prints text on the shot and loses the gesture. Ten is full quality, about twice the time."
        >
          <Select
            options={[
              { value: 4, label: '4 — draft' },
              { value: 10, label: '10 — full quality' },
              { value: 20, label: '20 — slow' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="lipsyncFps"
          label="Frame rate"
          extra="0 follows the reel's own rate, which is what avoids resampling. The renderer accepts 8 to 30."
        >
          <InputNumber min={0} max={30} style={{ width: 160 }} />
        </Form.Item>

        <Typography.Title level={5} style={{ marginTop: 24 }}>Research</Typography.Title>
        <Form.Item
          name="researchProvider"
          label="Who hunts the sources"
          extra="Claude dispatches headless subagents with web search. Local sends the approved plan to the research service on this machine — nothing leaves it, nothing is paid for. The critic and the writer stay on Claude either way."
        >
          <Select
            options={[
              { value: 'claude', label: 'Claude — headless subagents' },
              { value: 'local', label: 'Local — research service' },
            ]}
          />
        </Form.Item>
        <Form.Item name="researchUrl" label="Research service URL"><Input /></Form.Item>

        <Button type="primary" htmlType="submit">Save</Button>
      </Form>
    </div>
  );
}
