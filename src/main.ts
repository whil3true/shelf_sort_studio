import Phaser from 'phaser';
import { mountGame } from './ui/viewport';
import './style.css';

class StudioScene extends Phaser.Scene {
  constructor() { super('studio'); }
  create() {
    this.add.text(240, 360, 'Shelf Sort Studio', {
      fontFamily: 'Georgia, serif', fontSize: '40px', color: '#4a3326',
    }).setOrigin(0.5);
    const button = this.add.text(240, 460, 'Play', {
      fontFamily: 'Arial, sans-serif', fontSize: '24px', color: '#fff8eb',
      backgroundColor: '#39594a', padding: { x: 36, y: 12 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    button.on('pointerup', () => button.setText('The shop is open'));
  }
}

mountGame(new StudioScene());
