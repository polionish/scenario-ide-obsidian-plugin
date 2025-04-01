import { Plugin, Notice, TAbstractFile, TFile, TFolder, Modal } from 'obsidian';
import * as jsyaml from 'js-yaml';

interface YandexIoTTrigger {
  trigger: {
    type: string;
    value: string | { condition?: { type: string; value?: any }; days_of_week?: string[] | null; time_offset?: number };
  };
}

interface YandexIoTStep {
  type: string;
  parameters: { items: { id: string; type: string }[] };
}

interface YandexIoTScenario {
  id: string;
  name: string;
  triggers: YandexIoTTrigger[];
  steps: YandexIoTStep[];
  icon?: string;
  devices?: string[];
  [key: string]: any;
}

interface YandexIoTData {
  scenarios: YandexIoTScenario[];
}

export default class IoTManagerPlugin extends Plugin {
  async onload() {
    this.addCommand({
      id: 'import-yaml-scenario',
      name: 'Import YAML Scenario',
      callback: async () => {
        new Notice('Importing YAML scenario...');
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.yaml,.yml';
        input.onchange = async (e: Event) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) return;
          const text = await file.text();
          const fileName = file.name.replace(/\.[^/.]+$/, '');
          await this.app.vault.create(`${fileName}.md`, `# ${fileName}\n\`\`\`yaml\n${text}\n\`\`\``);
          new Notice(`Imported ${fileName} successfully!`);
        };
        input.click();
      }
    });

    this.addCommand({
      id: 'export-yaml-scenario',
      name: 'Export YAML Scenario',
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') return new Notice('Please open a Markdown file first.');
        const content = await this.app.vault.read(activeFile);
        const yamlMatch = content.match(/```yaml\n([\s\S]*?)\n```/);
        if (!yamlMatch) return new Notice('No YAML content found.');
        const blob = new Blob([yamlMatch[1]], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${activeFile.basename}.yaml`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        new Notice(`Exported ${activeFile.basename}.yaml successfully!`);
      }
    });

    this.addCommand({
      id: 'create-versioned-copy',
      name: 'Create Versioned Copy',
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') return new Notice('Please open a Markdown file first.');
        const content = await this.app.vault.read(activeFile);
        const yamlMatch = content.match(/```yaml\n([\s\S]*?)\n```/);
        if (!yamlMatch) return new Notice('No YAML content found.');
        const versionsFolder = 'versions';
        if (!this.app.vault.getAbstractFileByPath(versionsFolder)) await this.app.vault.createFolder(versionsFolder);
        const timestamp = new Date().toISOString().replace(/[:T-]/g, '').slice(0, 14);
        const versionedName = `${activeFile.basename}_${timestamp}`;
        await this.app.vault.create(`${versionsFolder}/${versionedName}.md`, `# ${versionedName}\n\`\`\`yaml\n${yamlMatch[1]}\n\`\`\``);
        new Notice(`Created versioned copy: ${versionedName}`);
      }
    });

    this.addCommand({
      id: 'show-scenario-versions',
      name: 'Show Scenario Versions',
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') return new Notice('Please open a Markdown file first.');
        const versionsFolder = 'versions';
        const versionsPath = this.app.vault.getAbstractFileByPath(versionsFolder) as TFolder;
        if (!versionsPath) return new Notice('No versions folder found.');
        const baseName = activeFile.basename;
        const versionFiles = versionsPath.children
          .filter((file: TAbstractFile): file is TFile => file instanceof TFile && file.name.startsWith(baseName) && file.extension === 'md')
          .map((file: TFile) => file.name)
          .sort();
        if (!versionFiles.length) return new Notice(`No versions found for ${baseName}.`);
        const versionsList = `# Versions of ${baseName}\n\n${versionFiles.map((v: string) => `- [[${versionsFolder}/${v}]]`).join('\n')}`;
        const versionsFileName = `Versions_of_${baseName}.md`;
        const existingFile = this.app.vault.getAbstractFileByPath(versionsFileName) as TFile;
        if (existingFile) {
          await this.app.vault.modify(existingFile, versionsList);
          new Notice(`Updated versions list for ${baseName}`);
          await this.app.workspace.getLeaf().openFile(existingFile);
        } else {
          const newFile = await this.app.vault.create(versionsFileName, versionsList);
          new Notice(`Created versions list for ${baseName}`);
          await this.app.workspace.getLeaf().openFile(newFile);
        }
      }
    });

    this.addCommand({
      id: 'validate-yaml-scenario',
      name: 'Validate YAML Scenario',
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') return new Notice('Please open a Markdown file first.');
        const content = await this.app.vault.read(activeFile);
        const yamlMatch = content.match(/```yaml\n([\s\S]*?)\n```/);
        if (!yamlMatch) return new Notice('No YAML content found.');
        try {
          const data = jsyaml.load(yamlMatch[1]) as YandexIoTData;
          if (!data?.scenarios || !Array.isArray(data.scenarios)) return new Notice('Invalid YAML: "scenarios" missing or not an array.');
          const errors: string[] = [];
          data.scenarios.forEach((s, i) => {
            const checkField = (field: string, value: any, type: string) => !value || typeof value !== type ? `${field} invalid` : null;
            errors.push(
              ...[checkField(`Scenario ${i}: id`, s.id, 'string'), checkField(`Scenario ${i}: name`, s.name, 'string')]
                .filter(Boolean) as string[]
            );
            if (!s.triggers || !Array.isArray(s.triggers)) errors.push(`Scenario ${i}: triggers missing or not an array`);
            else s.triggers.forEach((t, j) => {
              if (!t.trigger?.type || typeof t.trigger.type !== 'string') errors.push(`Scenario ${i}, Trigger ${j}: type invalid`);
              if (!('value' in t.trigger)) errors.push(`Scenario ${i}, Trigger ${j}: value missing`);
            });
            if (!s.steps || !Array.isArray(s.steps)) errors.push(`Scenario ${i}: steps missing or not an array`);
            else s.steps.forEach((st, k) => {
              if (!st.type || !st.parameters?.items || !Array.isArray(st.parameters.items)) errors.push(`Scenario ${i}, Step ${k}: invalid structure`);
            });
          });
          if (errors.length) new Notice(`YAML validation failed:\n${errors.join('\n')}`, 0);
          else new Notice('YAML is valid!');
        } catch (e) {
          new Notice(`YAML parsing error: ${(e as Error).message}`);
        }
      }
    });

    this.addCommand({
      id: 'generate-scenario-template',
      name: 'Generate Scenario Template',
      callback: () => {
        new class extends Modal {
          constructor(app: any) { super(app); }
          onOpen() {
            const { contentEl } = this;
            contentEl.createEl('h2', { text: 'Select Trigger Type' });
            const types = [
              { name: 'Voice', value: 'scenario.trigger.voice', defaultValue: 'Привет' },
              { name: 'Timetable', value: 'scenario.trigger.timetable', defaultValue: { condition: { type: 'solar', value: { solar: 'sunrise', offset: 3600 } } } }
            ];
            types.forEach(t => {
              contentEl.createEl('button', { text: t.name }).addEventListener('click', async () => {
                const template = {
                  scenarios: [{
                    id: `scenario_${Date.now()}`,
                    name: 'New Scenario',
                    triggers: [{ trigger: { type: t.value, value: t.defaultValue } }],
                    steps: [{ type: 'scenarios.steps.actions.v2', parameters: { items: [] } }]
                  }]
                };
                const yaml = jsyaml.dump(template);
                const fileName = `Scenario_${t.name}_${Date.now()}`;
                await this.app.vault.create(`${fileName}.md`, `# ${fileName}\n\`\`\`yaml\n${yaml}\n\`\`\``);
                new Notice(`Created template: ${fileName}`);
                this.close();
              });
            });
          }
          onClose() { this.contentEl.empty(); }
        }(this.app).open();
      }
    });

    this.addCommand({
      id: 'compare-scenario-versions',
      name: 'Compare Scenario Versions',
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') return new Notice('Please open a Markdown file first.');
        const versionsFolder = 'versions';
        const versionsPath = this.app.vault.getAbstractFileByPath(versionsFolder) as TFolder;
        if (!versionsPath) return new Notice('No versions folder found.');
        const baseName = activeFile.basename;
        const versionFiles = versionsPath.children
          .filter((file: TAbstractFile): file is TFile => file instanceof TFile && file.name.startsWith(baseName) && file.extension === 'md')
          .sort();
        if (!versionFiles.length) return new Notice(`No versions found for ${baseName}.`);
        new class extends Modal {
          constructor(app: any) { super(app); }
          onOpen() {
            const { contentEl } = this;
            contentEl.createEl('h2', { text: 'Select Version to Compare' });
            versionFiles.forEach(v => {
              contentEl.createEl('button', { text: v.name }).addEventListener('click', async () => {
                const currentContent = await this.app.vault.read(activeFile);
                const versionContent = await this.app.vault.read(v);
                const currentYaml = (currentContent.match(/```yaml\n([\s\S]*?)\n```/) || [])[1] || '';
                const versionYaml = (versionContent.match(/```yaml\n([\s\S]*?)\n```/) || [])[1] || '';
                const currentData = jsyaml.load(currentYaml) as YandexIoTData;
                const versionData = jsyaml.load(versionYaml) as YandexIoTData;
                const diff = this.simpleDiff(currentData, versionData);
                const diffFile = await this.app.vault.create(`Diff_${baseName}_${v.basename}.md`, `# Diff with ${v.basename}\n\n${diff}`);
                await this.app.workspace.getLeaf().openFile(diffFile);
                new Notice(`Comparison created: ${diffFile.basename}`);
                this.close();
              });
            });
          }
          onClose() { this.contentEl.empty(); }
          simpleDiff(current: any, version: any): string {
            const changes: string[] = [];
            const compare = (a: any, b: any, path: string) => {
              if (JSON.stringify(a) !== JSON.stringify(b)) {
                changes.push(`${path}: ${JSON.stringify(b)} → ${JSON.stringify(a)}`);
              }
            };
            current.scenarios.forEach((s: any, i: number) => {
              const v = version.scenarios[i] || {};
              compare(s.name, v.name, `Scenario ${i}.name`);
              compare(s.triggers, v.triggers, `Scenario ${i}.triggers`);
              compare(s.steps, v.steps, `Scenario ${i}.steps`);
            });
            return changes.length ? changes.join('\n') : 'No differences found.';
          }
        }(this.app).open();
      }
    });

    this.addCommand({
      id: 'simulate-scenario',
      name: 'Simulate Scenario',
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') return new Notice('Please open a Markdown file first.');
        const content = await this.app.vault.read(activeFile);
        const yamlMatch = content.match(/```yaml\n([\s\S]*?)\n```/);
        if (!yamlMatch) return new Notice('No YAML content found.');
        const data = jsyaml.load(yamlMatch[1]) as YandexIoTData;
        if (!data?.scenarios?.length) return new Notice('No scenarios to simulate.');
        const simulation: string[] = [];
        data.scenarios.forEach((s, i) => {
          simulation.push(`Scenario ${i}: ${s.name}`);
          s.triggers.forEach((t, j) => {
            const value = typeof t.trigger.value === 'string' ? t.trigger.value : JSON.stringify(t.trigger.value);
            simulation.push(`  Trigger ${j}: ${t.trigger.type} -> ${value}`);
          });
          s.steps.forEach((st, k) => {
            const items = st.parameters.items.map(it => `${it.type} (${it.id})`).join(', ');
            simulation.push(`  Step ${k}: ${st.type} -> ${items || 'No actions'}`);
          });
        });
        new Notice(`Simulation:\n${simulation.join('\n')}`, 0);
      }
    });
  }

  onunload() {
    console.log('Unloading IoT Manager plugin');
  }
}