/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */
/**
 * @fileoverview
 *
 * Runs all tests described by this document, after giving the document a chance
 * to load.
 *
 * If `WCT.waitForFrameworks` is true (the default), we will also wait for any
 * present web component frameworks to have fully initialized as well.
 */
(function() {

// Give any scripts on the page a chance to twiddle the environment.
document.addEventListener('DOMContentLoaded', function() {
  WCT.util.debug('run stage: DOMContentLoaded');
  var subSuite = WCT.SubSuite.current();
  if (subSuite) {
    WCT.util.debug('run stage: subsuite');
    // Give the subsuite time to complete its load (see `SubSuite.load`).
    async.nextTick(runSubSuite.bind(null, subSuite));
    return;
  }

  // Before anything else, we need to ensure our communication channel with the
  // CLI runner is established (if we're running in that context). Less
  // buffering to deal with.
  WCT.CLISocket.init(function(error, socket) {
    WCT.util.debug('run stage: WCT.CLISocket.init done', error);
    if (error) throw error;
    var runner = newMultiSuiteRunner(determineReporters(socket));

    loadDependencies(runner, function(error) {
      WCT.util.debug('run stage: loadDependencies done', error);
      if (error) throw error;

      runMultiSuite(runner);
    });
  });
});

/**
 * Loads any dependencies of the _current_ suite (e.g. `.js` sources).
 *
 * @param {!WCT.MultiRunner} runner The runner where errors should be reported.
 * @param {function} done A node style callback.
 */
function loadDependencies(runner, done) {
  WCT.util.debug('loadDependencies:', WCT._dependencies);

  function onError(event) {
    console.warn(event);
    runner.emitOutOfBandTest('Test Suite Initialization', event.error);
  }
  window.addEventListener('error', onError);

  var loaders = WCT._dependencies.map(function(file) {
    // We only support `.js` dependencies for now.
    return WCT.util.loadScript.bind(WCT.util, file);
  });

  async.parallel(loaders, function(error) {
    window.removeEventListener('error', onError);
    done(error);
  });
}

/**
 * @param {!WCT.SubSuite} subSuite The `SubSuite` for this frame, that `mocha`
 *     should be run for.
 */
function runSubSuite(subSuite) {
  WCT.util.debug('runSubSuite', window.location.pathname);
  // Not very pretty.
  var parentWCT = subSuite.parentScope.WCT;
  var suiteName = parentWCT.util.relativeLocation(window.location);
  var reporter  = parentWCT._multiRunner.childReporter(suiteName);
  runMocha(reporter, subSuite.done.bind(subSuite));
}

/**
 * @param {!Array.<!Mocha.reporters.Base>} reporters The reporters that should
 *     consume the output of this `MultiRunner`.
 * @return {!WCT.MultiRunner} The runner for our root suite.
 */
function newMultiSuiteRunner(reporters) {
  WCT.util.debug('newMultiSuiteRunner', window.location.pathname);
  var runner   = new WCT.MultiRunner(WCT._suitesToLoad.length + 1, reporters);
  WCT._multiRunner = runner;

  return runner;
}

/**
 * @param {!WCT.MultiRunner} The runner built via `newMultiSuiteRunner`.
 */
function runMultiSuite(runner) {
  WCT.util.debug('runMultiSuite', window.location.pathname);
  var rootName = WCT.util.relativeLocation(window.location);

  var suiteRunners = [
    // Run the local tests (if any) first, not stopping on error;
    runMocha.bind(null, runner.childReporter(rootName)),
  ];

  // As well as any sub suites. Again, don't stop on error.
  WCT._suitesToLoad.forEach(function(file) {
    suiteRunners.push(function(next) {
      var subSuite = new WCT.SubSuite(file, window);
      subSuite.run(function(error) {
        if (error) runner.emitOutOfBandTest(file, error);
        next();
      });
    });
  });

  async.parallelLimit(suiteRunners, WCT.numConcurrentSuites, function(error) {
    WCT.util.debug('runMultiSuite done', error);
    runner.done();
  });
}

/**
 * Kicks off a mocha run, waiting for frameworks to load if necessary.
 *
 * @param {!Mocha.reporters.Base} reporter The reporter to pass to `mocha.run`.
 * @param {function} done A callback fired, _no error is passed_.
 */
function runMocha(reporter, done, waited) {
  if (WCT.waitForFrameworks && !waited) {
    WCT.util.whenFrameworksReady(runMocha.bind(null, reporter, done, true));
    return;
  }
  WCT.util.debug('runMocha', window.location.pathname);

  mocha.reporter(reporter);
  var runner = mocha.run(function(error) {
    done();  // We ignore the Mocha failure count.
  });

  // Mocha's default `onerror` handling strips the stack (to support really old
  // browsers). We upgrade this to get better stacks for async errors.
  //
  // TODO(nevir): Can we expand support to other browsers?
  if (navigator.userAgent.match(/chrome/i)) {
    window.onerror = null;
    window.addEventListener('error', function(event) {
      if (error.ignore) return;
      runner.uncaught(event.error);
    });
  }
}

/**
 * Figure out which reporters should be used for the current `window`.
 *
 * @param {WCT.CLISocket} socket The CLI socket, if present.
 */
function determineReporters(socket) {
  var reporters = [
    WCT.reporters.Title,
    WCT.reporters.Console,
  ];

  if (socket) {
    reporters.push(function(runner) {
      socket.observe(runner);
    });
  }

  if (WCT._suitesToLoad.length > 0 || WCT._dependencies.length > 0) {
    reporters.push(WCT.reporters.HTML);
  }

  return reporters;
}

})();
