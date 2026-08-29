'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Form, Input, Row, Typography, message } from 'antd';

export default function AssetsPage() {
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [comfyUp, setComfyUp] = useState(true);
  const [form] = Form.useForm();

  const load = () => fetch('/api/assets').then((r) => r.json()).then((d) => setFiles(d.files ?? []));
  useEffect(() => {
    load();
    fetch('/api/comfy/status').then((r) => r.json()).then((s) => setComfyUp(!!s.up));
  }, []);

  const generate = async (v: { name: string; prompt: string }) => {
    setBusy(true);
    message.info('Generating — job visible in ComfyUI Desktop queue');
    try {
      const r = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(v),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      message.success(`Generated ${body.file}`);
      form.resetFields();
      load();
    } catch (err) {
      message.error(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Typography.Title level={4}>Doodle assets</Typography.Title>
      {!comfyUp && <Alert type="warning" showIcon message="ComfyUI offline — start the Desktop app to generate assets." style={{ marginBottom: 12 }} />}

      <Card size="small" style={{ marginBottom: 16, maxWidth: 620 }} title="Generate new asset">
        <Form form={form} layout="inline" onFinish={generate} disabled={!comfyUp || busy}>
          <Form.Item name="name" rules={[{ required: true, pattern: /^[a-z0-9-]+$/, message: 'slug style' }]}>
            <Input placeholder="python-logo" />
          </Form.Item>
          <Form.Item name="prompt" rules={[{ required: true }]} style={{ flex: 1 }}>
            <Input placeholder="the Python snake logo" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>Generate</Button>
        </Form>
      </Card>

      {files.length === 0 ? (
        <Empty description="No doodles yet" />
      ) : (
        <Row gutter={[12, 12]}>
          {files.map((f) => (
            <Col key={f} span={4}>
              <Card size="small" cover={
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={`/api/assets?file=${encodeURIComponent(f)}`} alt={f} style={{ background: '#fff' }} />
              }>
                <Card.Meta description={f} />
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
