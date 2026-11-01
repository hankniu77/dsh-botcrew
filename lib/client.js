window.__ModuleLoader__.load({
  id: 'dsh-botcrew',
  factory: (require) => {
    const React = require('react');
    const module = { exports: {} };
    const exports = module.exports;
    const ID = 'dsh-botcrew';
    const KIND = 'office-panel';
    const GROUP_CHAT_ID = 'office-group-chat';

    const GroupChatIcon = (props) =>
      React.createElement(
        'svg',
        Object.assign(
          {
            width: 18,
            height: 18,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.7,
            strokeLinecap: 'round',
            strokeLinejoin: 'round'
          },
          props
        ),
        React.createElement('path', {
          d: 'M21 11.5a8.4 8.4 0 0 1-8.5 8.3 9 9 0 0 1-3.7-.8L3 21l1.7-4.2A8.1 8.1 0 0 1 3.5 11.5 8.4 8.4 0 0 1 12 3.2a8.4 8.4 0 0 1 9 8.3Z'
        }),
        React.createElement('path', { d: 'M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01' })
      );

    const GroupChatView = () =>
      React.createElement('iframe', {
        src: 'http://127.0.0.1:8765/group-chat',
        title: '对话群聊',
        style: {
          width: '100%',
          height: '100%',
          border: '0',
          display: 'block',
          background: '#f7f5f0'
        }
      });

    exports.inject = ['slots', 'sidebarRightTabs', 'layout'];

    exports.apply = (ctx) => {
      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: ID,
            kind: KIND,
            priority: 'extension',
            title: () => '工位面板',
            guide: [
              {
                id: 'office-panel',
                order: 31,
                title: () => '工位面板',
                description: () => 'WorkBuddy / 千问办公实时状态'
              }
            ]
          }),
        'office-panel.type'
      );

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              {
                name: 'sidebar.right.pane.tab',
                key: ID
              },
              () =>
                React.createElement('iframe', {
                  src: 'http://127.0.0.1:8765/?embed=1',
                  title: '工位面板',
                  style: {
                    width: '100%',
                    height: '100%',
                    border: '0',
                    background: '#f3f0ea'
                  }
                })
            )
          ),
        'office-panel.body'
      );

      ctx.slots.inject('main', function* () {
        yield ctx.slots.register(
          {
            name: 'main',
            key: GROUP_CHAT_ID
          },
          GroupChatView
        );
      });

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: GROUP_CHAT_ID,
            order: 10,
            label: () => '对话群聊'
          },
          GroupChatIcon
        )
      );

      const mountWorkspaceRow = (ctx) => {
        let row;
        let tree;
        let observer;
        const ensure = () => {
          const original = [...document.querySelectorAll('button')].find(
            (b) => b.textContent.trim() === '对话群聊' && String(b.className).includes('panelRow')
          );
          if (original) original.style.display = 'none';
          if (!tree || !document.contains(tree)) {
            tree = document.querySelector('[role="tree"]') || document.querySelector('[aria-label="会话"]');
          }
          if (!tree) return;
          if (row && tree.contains(row)) return;
          row = document.createElement('div');
          row.setAttribute('role', 'treeitem');
          row.setAttribute('data-office-group-chat', '1');
          row.tabIndex = 0;
          row.innerHTML =
            '<span style="display:inline-flex;width:16px;justify-content:center;color:#6a4df0">◍</span><span>对话群聊</span>';
          Object.assign(row.style, {
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '0 10px',
            margin: '2px 8px',
            borderRadius: '8px',
            font: '13px -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif',
            color: '#3c3933',
            cursor: 'pointer',
            userSelect: 'none'
          });
          row.addEventListener('mouseenter', () => {
            row.style.background = '#ece7de';
          });
          row.addEventListener('mouseleave', () => {
            row.style.background = '';
          });
          const open = () => ctx.layout.selectPanel(GROUP_CHAT_ID);
          row.addEventListener('click', open);
          row.addEventListener('pointerdown', open);
          row.addEventListener('mousedown', open);
          row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              open();
            }
          });
          tree.insertBefore(row, tree.firstChild);
        };
        ensure();
        observer = new MutationObserver(ensure);
        observer.observe(document.body, { childList: true, subtree: true });
        const timer = setInterval(ensure, 1000);
        return () => {
          observer.disconnect();
          clearInterval(timer);
          if (row) row.remove();
        };
      };
      ctx.effect(() => mountWorkspaceRow(ctx), 'office-group-chat.workspace-row');

      if (window.__officeGroupChatClick) {
        document.removeEventListener('click', window.__officeGroupChatClick, true);
      }
      window.__officeGroupChatClick = (e) => {
        const target = e.target && e.target.closest ? e.target.closest('[data-office-group-chat]') : null;
        if (target) ctx.layout.selectPanel(GROUP_CHAT_ID);
      };
      document.addEventListener('click', window.__officeGroupChatClick, true);

      if (window.__officeGroupChatPointer) {
        document.removeEventListener('pointerdown', window.__officeGroupChatPointer, true);
      }
      window.__officeGroupChatPointer = (e) => {
        const target = e.target && e.target.closest ? e.target.closest('[data-office-group-chat]') : null;
        if (target) ctx.layout.selectPanel(GROUP_CHAT_ID);
      };
      document.addEventListener('pointerdown', window.__officeGroupChatPointer, true);
    };

    return module.exports;
  }
});


