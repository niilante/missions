import store from '../store';
import timeout from 'callback-timeout';
import { 
  chooseBid,
  updateDavId, 
  unlockWallet,
  unregisteredDavId,
  registerDavIdFulfilled,
  createMissionTransactionFulfilled,
  createMissionTransactionFailed
} from '../actions';
const TruffleContract = require('truffle-contract');
const Web3 = require('web3');

const BLOCKCHAIN_TYPE = process.env.BLOCKCHAIN_TYPE || 'INJECTED';

let web3Provider = null;
// Use injected web3 instance
if (typeof window !== 'undefined' && typeof window.web3 !== 'undefined') {
  web3Provider = window.web3.currentProvider;
} else if(BLOCKCHAIN_TYPE === 'ETH_LOCAL_TESTNET') {
  // If no injected web3 instance is detected, fall back to Ganache
  web3Provider = new Web3
    .providers
    .HttpProvider('http://localhost:8545');
}

let web3 = new Web3(web3Provider);
let davSDK;

const DavContracts = function() {
  let contracts = {
    identity: {
      artifact: TruffleContract(require('../build/contracts/Identity.json')),
      instance: null
    },
    token: {
      artifact: TruffleContract(require('../build/contracts/DAVToken.json')),
      instance: null
    },
    mission: {
      artifact: TruffleContract(require('../build/contracts/BasicMission.json')),
      instance: null
    }
  };

  this.getInstance = function(contract) {
    return new Promise (function (resolve, reject) {
      if(contracts[contract].instance) {
        resolve(contracts[contract].instance);
      } else {
        contracts[contract].artifact.setProvider(web3.currentProvider);
        contracts[contract].artifact.deployed()
          .then(function (instance) {
            contracts[contract].instance = instance;
            resolve(contracts[contract].instance);
          }).catch(function(err) {
            reject(err);
          });
      }
    });
  };
};

let davJS = function(davId, wallet) {
  this.davId = davId;
  this.wallet = wallet;
  this.davContracts = new DavContracts();

  this.isRegistered = function () {
    let dav = this;
    return this.davContracts.getInstance('identity')
      .then(function (instance) {
        return instance.isRegistered.call(dav.davId, { from: dav.wallet });
      });
  };

  this.registerSimple = function () {
    let dav = this;
    if (process.env.NODE_ENV === 'development' && BLOCKCHAIN_TYPE === 'NONE') {
      return Promise.resolve({});
    }
  
    return new Promise(function (resolve, reject) {
      return dav.davContracts.getInstance('identity')
        .then(function (identityContractInstance) {
          return identityContractInstance
            .registerSimple({ from: dav.wallet })
            .then(function (res) {
              console.log(res);
              resolve(true);
            })
            .catch(function (err) {
              reject(err);
            });
          
        }).catch(function (err) {
          reject(err);
        });
    });
  };

  this.createMissionTransaction = function (vehicleId, missionCost) {
    let dav = this;
    if (process.env.NODE_ENV === 'development' && BLOCKCHAIN_TYPE === 'NONE') {
      return Promise.resolve(true);
    }
  
    var tokenContractInstance;
    var missionContractInstance;
    return dav.davContracts.getInstance('token')
      .then(function (instance) {
        tokenContractInstance = instance;
        return dav.davContracts.getInstance('mission')
          .then((instance) => {
            missionContractInstance = instance;
            return tokenContractInstance.approve(missionContractInstance.address, missionCost, { from: dav.wallet });
          })
          .then(() => {
            return missionContractInstance.create(vehicleId, dav.davId, missionCost, { from: dav.wallet });
          });
      });
  };
};

export const initWeb3 = () => {
  if(process.env.BLOCKCHAIN_TYPE === 'NONE') {
    store.dispatch(registerDavIdFulfilled());
    return Promise.resolve('Blockchain is disabled');
  }
  return new Promise (function (resolve, reject) {
    web3.eth.getAccounts(timeout((error, accounts) => {
      if(error) {
        console.log(error);
        store.dispatch(unlockWallet());
        resolve(error);
      } else if(accounts.length > 0) {
        let davId = accounts[0];
        store.dispatch(updateDavId({ davId }));
        return isRegistered(davId);
      } else {
        // unlock metamask
        store.dispatch(unlockWallet());
        console.log('The wallet locked, please unlock it to continue.');
        resolve('The wallet locked, please unlock it to continue.');
      }
      reject();
    }, 1500));
  });
};

export const isRegistered = (davId) => {
  davSDK = new davJS(davId, davId);
  davSDK.isRegistered().then((isRegistered) => {
    if(isRegistered) {
      store.dispatch(registerDavIdFulfilled());
    } else {
      store.dispatch(unregisteredDavId());
    }
  }).catch(err => {
    console.log(err);
  });
};

export const registerDavId = () => {
  davSDK.registerSimple().then((isRegistered) => {
    if(isRegistered === true) {
      store.dispatch(registerDavIdFulfilled());
    }
  }).catch(err => {
    console.log(err);
  });
};

export const createMissionTransaction = (bidId, vehicle_id, price) => {
  if(process.env.BLOCKCHAIN_TYPE === 'NONE') {
    store.dispatch(createMissionTransactionFulfilled());
    return Promise.resolve('Blockchain is disabled');
  }
  davSDK.createMissionTransaction(vehicle_id, price).then((response) => {
    console.log(response);
    store.dispatch(createMissionTransactionFulfilled(response));
    store.dispatch(chooseBid(bidId));
  }).catch(err => {
    console.log(err);
    store.dispatch(createMissionTransactionFailed(err));
  });
};
