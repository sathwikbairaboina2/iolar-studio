'use client';
import { useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, Select, Typography } from 'antd';
import { message } from '@/lib/ui/message';

const RATIO_OPTS = ['3:4', '4:5', '1:1'].map((v) => ({ value: v }));

export default function SettingsPage() {
  const [form] = Form.useForm();
  const [templates, setTemplates] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((s) => form.setFieldsValue(s));
    fetch('/api/handbooks').then((r) => r.json()).then((d) => setTemplates(d.templates ?? [])).catch(() => {});
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
        <Form.Item name="defaultTemplate" label="Default template"><Select options={templates.map((t) => ({ value: t }))} showSearch /></Form.Item>
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

        <Typography.Title level={5} style={{ marginTop: 24 }}>Who does the thinking</Typography.Title>
        <Form.Item
          name="llmProvider"
          label="Every model call in the studio"
          extra="One switch for the whole studio: the handbook planner, the reel writer, the research hunt, the reel agent and the job card reader all go the same way. Claude runs headless and can search the web. Local runs the model below on this machine — nothing leaves it, nothing is paid for, and it has no web. OpenRouter is a hosted model over the network: it costs money and the topic leaves the house, but it leaves the card free, and it has no web or tools either, so the research hunt and the reel agent refuse it. Moving to either remote one unloads the local model; moving back loads it again on the first call."
        >
          <Select
            options={[
              { value: 'claude', label: 'Claude — headless, with web search' },
              { value: 'openrouter', label: 'OpenRouter — a hosted model, no web' },
              { value: 'local', label: 'Local — the model on this machine' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="openrouterModel"
          label="OpenRouter model"
          extra="Read only while the switch above is on OpenRouter, in the router's own vendor/model spelling. The key is not kept here: set OPENROUTER_API_KEY in the environment this app starts in, or every call fails saying so."
        >
          <Input />
        </Form.Item>
        <Form.Item name="researchUrl" label="Research service URL"><Input /></Form.Item>
        <Form.Item name="researchOllamaUrl" label="Ollama for the local model" extra="Every stage thinks here while the provider is local; this is also the ollama that is unloaded when it is not."><Input /></Form.Item>
        <Form.Item name="researchModel" label="Local model"><Input /></Form.Item>

        <Button type="primary" htmlType="submit">Save</Button>
      </Form>
    </div>
  );
}
