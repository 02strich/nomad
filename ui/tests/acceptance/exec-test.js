import { module, test } from 'qunit';
import { currentURL, settled } from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';
import { setupMirage } from 'ember-cli-mirage/test-support';
import Service from '@ember/service';
import Exec from 'nomad-ui/tests/pages/exec';

module('Acceptance | exec', function(hooks) {
  setupApplicationTest(hooks);
  setupMirage(hooks);

  hooks.beforeEach(async function() {
    server.create('agent');
    server.create('node');

    this.job = server.create('job', { groupsCount: 2 });
  });

  test('/exec/:job should show the region, namespace, and job name', async function(assert) {
    server.create('namespace');
    const namespace = server.create('namespace');

    server.create('region', { id: 'global' });
    server.create('region', { id: 'region-2' });

    this.job = server.create('job', { createAllocations: false, namespaceId: namespace.id });

    await Exec.visitJob({ job: this.job.id, namespace: namespace.id, region: 'region-2' });

    assert.equal(document.title, 'Exec - region-2 - Nomad');

    assert.equal(Exec.header.region.text, this.job.region);
    assert.equal(Exec.header.namespace.text, this.job.namespace);
    assert.equal(Exec.header.job, this.job.name);
  });

  test('/exec/:job should not show region and namespace when there are none', async function(assert) {
    await Exec.visitJob({ job: this.job.id });

    assert.ok(Exec.header.region.isHidden);
    assert.ok(Exec.header.namespace.isHidden);
  });

  test('/exec/:job should show the task groups collapsed by default allow the tasks to be shown', async function(assert) {
    await Exec.visitJob({ job: this.job.id });

    assert.equal(Exec.taskGroups.length, this.job.task_groups.length);

    assert.equal(Exec.taskGroups[0].name, this.job.task_groups.models[0].name);
    assert.equal(Exec.taskGroups[0].tasks.length, 0);
    assert.ok(Exec.taskGroups[0].chevron.isRight);

    await Exec.taskGroups[0].click();
    assert.equal(Exec.taskGroups[0].tasks.length, this.job.task_groups.models[0].tasks.length);
    assert.notOk(Exec.taskGroups[0].tasks[0].isActive);
    assert.ok(Exec.taskGroups[0].chevron.isDown);

    await Exec.taskGroups[0].click();
    assert.equal(Exec.taskGroups[0].tasks.length, 0);
  });

  test('/exec/:job should require selecting a task', async function(assert) {
    await Exec.visitJob({ job: this.job.id });

    assert.equal(
      window.execTerminal.buffer
        .getLine(0)
        .translateToString()
        .trim(),
      'Select a task to start your session.'
    );
  });

  test('visiting a path with a task group should open the group by default', async function(assert) {
    const taskGroup = this.job.task_groups.models[0];
    await Exec.visitTaskGroup({ job: this.job.id, task_group: taskGroup.name });

    assert.equal(Exec.taskGroups[0].tasks.length, this.job.task_groups.models[0].tasks.length);
    assert.ok(Exec.taskGroups[0].chevron.isDown);

    const task = taskGroup.tasks.models[0];
    await Exec.visitTask({ job: this.job.id, task_group: taskGroup.name, task_name: task.name });

    assert.equal(Exec.taskGroups[0].tasks.length, this.job.task_groups.models[0].tasks.length);
    assert.ok(Exec.taskGroups[0].chevron.isDown);
  });

  test('navigating to a task adds its name to the route, chooses an allocation, and assigns a default command', async function(assert) {
    await Exec.visitJob({ job: this.job.id });
    await Exec.taskGroups[0].click();
    await Exec.taskGroups[0].tasks[0].click();

    const taskGroup = this.job.task_groups.models[0];
    const task = taskGroup.tasks.models[0];

    const taskStates = this.server.db.taskStates.where({
      name: task.name,
    });
    const allocationId = taskStates.find(ts => ts.allocationId).allocationId;

    await settled();

    assert.equal(currentURL(), `/exec/${this.job.id}/${taskGroup.name}/${task.name}`);
    assert.ok(Exec.taskGroups[0].tasks[0].isActive);

    assert.equal(
      window.execTerminal.buffer
        .getLine(2)
        .translateToString()
        .trim(),
      'Multiple instances of this task are running. The allocation below was selected by random draw.'
    );

    assert.equal(
      window.execTerminal.buffer
        .getLine(4)
        .translateToString()
        .trim(),
      'To start the session, customize your command, then hit ‘return’ to run.'
    );

    assert.equal(
      window.execTerminal.buffer
        .getLine(6)
        .translateToString()
        .trim(),
      `$ nomad alloc exec -i -t -task ${task.name} ${allocationId.split('-')[0]} /bin/bash`
    );
  });

  test('an allocation can be specified', async function(assert) {
    const taskGroup = this.job.task_groups.models[0];
    const task = taskGroup.tasks.models[0];
    const allocations = this.server.db.allocations.where({
      jobId: this.job.id,
      taskGroup: taskGroup.name,
    });
    const allocation = allocations[allocations.length - 1];

    await Exec.visitTask({
      job: this.job.id,
      task_group: taskGroup.name,
      task_name: task.name,
      allocation: allocation.id.split('-')[0],
    });

    await settled();

    assert.equal(
      window.execTerminal.buffer
        .getLine(4)
        .translateToString()
        .trim(),
      `$ nomad alloc exec -i -t -task ${task.name} ${allocation.id.split('-')[0]} /bin/bash`
    );
  });

  test('running the command opens the socket for reading/writing and detects it closing', async function(assert) {
    const mockSocket = new Object({
      sent: [],

      send(message) {
        this.sent.push(message);
      },
    });

    const mockSockets = Service.extend({
      getTaskStateSocket(taskState, command) {
        assert.equal(taskState.name, task.name);
        assert.equal(taskState.allocation.id, allocation.id);

        assert.equal(command, '/bin/bash');

        assert.step('Socket built');

        return mockSocket;
      },
    });

    this.owner.register('service:sockets', mockSockets);

    const taskGroup = this.job.task_groups.models[0];
    const task = taskGroup.tasks.models[0];
    const allocations = this.server.db.allocations.where({
      jobId: this.job.id,
      taskGroup: taskGroup.name,
    });
    const allocation = allocations[allocations.length - 1];

    await Exec.visitTask({
      job: this.job.id,
      task_group: taskGroup.name,
      task_name: task.name,
      allocation: allocation.id.split('-')[0],
    });

    await settled();

    await Exec.terminal.pressEnter();
    await settled();

    assert.verifySteps(['Socket built']);

    mockSocket.onmessage({
      data: '{"stdout":{"data":"c2gtMy4yIPCfpbMk"}}',
    });

    await settled();

    assert.equal(
      window.execTerminal.buffer
        .getLine(5)
        .translateToString()
        .trim(),
      'sh-3.2 🥳$'
    );

    await Exec.terminal.pressEnter();
    await settled();

    assert.deepEqual(mockSocket.sent, ['{"stdin":{"data":"DQ=="}}']);

    await mockSocket.onclose();
    await settled();

    assert.equal(
      window.execTerminal.buffer
        .getLine(6)
        .translateToString()
        .trim(),
      'The connection has closed.'
    );
  });

  test('the command can be customised', async function(assert) {
    const mockSocket = new Object({
      sent: [],

      send(message) {
        this.sent.push(message);
      },
    });

    const mockSockets = Service.extend({
      getTaskStateSocket(taskState, command) {
        assert.equal(command, '/sh');

        assert.step('Socket built');

        return mockSocket;
      },
    });

    this.owner.register('service:sockets', mockSockets);

    await Exec.visitJob({ job: this.job.id });
    await Exec.taskGroups[0].click();
    await Exec.taskGroups[0].tasks[0].click();

    const taskGroup = this.job.task_groups.models[0];
    const task = taskGroup.tasks.models[0];
    const allocation = this.server.db.allocations.findBy({
      jobId: this.job.id,
      taskGroup: taskGroup.name,
    });

    await settled();

    // Delete /bash
    await window.execTerminal.simulateCommandKeyEvent({ domEvent: { key: 'Backspace' } });
    await window.execTerminal.simulateCommandKeyEvent({ domEvent: { key: 'Backspace' } });
    await window.execTerminal.simulateCommandKeyEvent({ domEvent: { key: 'Backspace' } });
    await window.execTerminal.simulateCommandKeyEvent({ domEvent: { key: 'Backspace' } });
    await window.execTerminal.simulateCommandKeyEvent({ domEvent: { key: 'Backspace' } });

    // Delete /bin and try to go beyond
    await window.execTerminal.simulateCommandKeyEvent({ domEvent: { key: 'Backspace' } });
    await window.execTerminal.simulateCommandKeyEvent({ domEvent: { key: 'Backspace' } });
    await window.execTerminal.simulateCommandKeyEvent({ domEvent: { key: 'Backspace' } });
    await window.execTerminal.simulateCommandKeyEvent({ domEvent: { key: 'Backspace' } });
    await window.execTerminal.simulateCommandKeyEvent({ domEvent: { key: 'Backspace' } });
    await window.execTerminal.simulateCommandKeyEvent({ domEvent: { key: 'Backspace' } });
    await window.execTerminal.simulateCommandKeyEvent({ domEvent: { key: 'Backspace' } });

    await settled();

    assert.equal(
      window.execTerminal.buffer
        .getLine(6)
        .translateToString()
        .trim(),
      `$ nomad alloc exec -i -t -task ${task.name} ${allocation.id.split('-')[0]}`
    );

    await window.execTerminal.simulateCommandKeyEvent({ key: '/', domEvent: {} });
    await window.execTerminal.simulateCommandKeyEvent({ key: 's', domEvent: {} });
    await window.execTerminal.simulateCommandKeyEvent({ key: 'h', domEvent: {} });

    await Exec.terminal.pressEnter();
    await settled();

    assert.verifySteps(['Socket built']);
  });
});
